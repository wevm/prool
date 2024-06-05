import { EventEmitter } from 'eventemitter3'

type EventTypes = {
  exit: [code: number | null, signal: NodeJS.Signals | null]
  listening: []
  message: [message: string]
  stderr: [message: string]
  stdout: [message: string]
}

export type InstanceStartOptions_internal = {
  emitter: EventEmitter<EventTypes>
  status: Instance['status']
}
export type InstanceStopOptions_internal = {
  emitter: EventEmitter<EventTypes>
  status: Instance['status']
}

export type InstanceStartOptions = {
  /**
   * Port to start the instance on.
   */
  port?: number | undefined
}

export type DefineInstanceFn<
  parameters,
  _internal extends object | undefined = object | undefined,
> = (parameters: parameters) => Pick<Instance, 'host' | 'name' | 'port'> & {
  _internal?: _internal | undefined
  start(
    options: InstanceStartOptions,
    options_internal: InstanceStartOptions_internal,
  ): Promise<void>
  stop(options_internal: InstanceStopOptions_internal): Promise<void>
}

export type Instance<
  _internal extends object | undefined = object | undefined,
> = Pick<
  EventEmitter<EventTypes>,
  | 'addListener'
  | 'off'
  | 'on'
  | 'once'
  | 'removeAllListeners'
  | 'removeListener'
> & {
  _internal: _internal
  /**
   * Creates an instance.
   */
  create(
    parameters?: { port?: number | undefined } | undefined,
  ): Omit<Instance<_internal>, 'create'>
  /**
   * Host the instance is running on.
   */
  host: string
  /**
   * Name of the instance.
   *
   * @example "anvil"
   */
  name: string
  /**
   * Port the instance is running on.
   */
  port: number
  /**
   * Set of messages emitted from the `"message"` event stored in-memory,
   * with length {@link InstanceOptions`messageBuffer`}.
   * Useful for debugging.
   *
   * @example ["Listening on http://127.0.0.1", "Started successfully."]
   */
  messages: { clear(): void; get(): string[] }
  /**
   * Retarts the instance.
   */
  restart(): Promise<void>
  /**
   * Status of the instance.
   *
   * @default "idle"
   */
  status:
    | 'idle'
    | 'restarting'
    | 'stopped'
    | 'starting'
    | 'started'
    | 'stopping'
  /**
   * Starts the instance.
   *
   * @returns A function to stop the instance.
   */
  start(): Promise<() => void>
  /**
   * Stops the instance.
   */
  stop(): Promise<void>
}

export type InstanceOptions = {
  /** Number of messages to store in-memory. @default 20 */
  messageBuffer?: number
  /** Timeout (in milliseconds) for starting and stopping the instance. @default 10_000 */
  timeout?: number
}

export type DefineInstanceReturnType<
  _internal extends object | undefined = object | undefined,
  parameters = undefined,
> = (
  ...parameters: parameters extends undefined
    ? [options?: InstanceOptions]
    : [parameters: parameters, options?: InstanceOptions]
) => Instance<_internal>

/**
 * Creates an instance definition.
 *
 * @param fn - Function to define the instance.
 *
 * @example
 * ```ts
 * const foo = defineInstance((parameters: FooParameters) => {
 *  return {
 *    name: 'foo',
 *    host: 'localhost',
 *    port: 3000,
 *    async start() {
 *      // ...
 *    },
 *    async stop() {
 *      // ...
 *    },
 *  }
 * })
 * ```
 */
export function defineInstance<
  _internal extends object | undefined,
  parameters = undefined,
>(
  fn: DefineInstanceFn<parameters, _internal>,
): DefineInstanceReturnType<_internal, parameters> {
  return (...[parametersOrOptions, options_]) => {
    function create(createParameters: Parameters<Instance['create']>[0] = {}) {
      const parameters = parametersOrOptions as parameters
      const options = options_ || parametersOrOptions || {}

      const { _internal, host, name, port, start, stop } = {
        ...fn(parameters),
        ...createParameters,
      }
      const { messageBuffer = 20, timeout } = options

      let restartResolver = Promise.withResolvers<void>()
      let startResolver = Promise.withResolvers<() => void>()
      let stopResolver = Promise.withResolvers<void>()

      const emitter = new EventEmitter<EventTypes>()

      let messages: string[] = []
      let status: Instance['status'] = 'idle'
      let restarting = false

      function onExit() {
        status = 'stopped'
      }
      function onListening() {
        status = 'started'
      }
      function onMessage(message: string) {
        messages.push(message)
        if (messages.length > messageBuffer) messages.shift()
      }

      return {
        _internal: _internal as _internal,
        messages: {
          clear() {
            messages = []
          },
          get() {
            return messages
          },
        },
        host,
        name,
        port,
        get status() {
          if (restarting) return 'restarting'
          return status
        },
        async start() {
          if (status === 'starting') return startResolver.promise
          if (status !== 'idle' && status !== 'stopped')
            throw new Error(
              `Instance "${name}" is not in an idle or stopped state. Status: ${status}`,
            )

          if (typeof timeout === 'number') {
            const timer = setTimeout(() => {
              clearTimeout(timer)
              startResolver.reject(
                new Error(`Instance "${name}" failed to start in time.`),
              )
            }, timeout)
          }

          emitter.on('message', onMessage)
          emitter.on('listening', onListening)
          emitter.on('exit', onExit)

          status = 'starting'
          start(
            {
              port,
            },
            {
              emitter,
              status: this.status,
            },
          )
            .then(() => {
              status = 'started'

              stopResolver = Promise.withResolvers<void>()
              startResolver.resolve(this.stop.bind(this))
            })
            .catch((error) => {
              status = 'idle'
              this.messages.clear()
              emitter.off('message', onMessage)
              startResolver.reject(error)
            })

          return startResolver.promise
        },
        async stop() {
          if (status === 'stopping') return stopResolver.promise
          if (status === 'starting')
            throw new Error(`Instance "${name}" is starting.`)

          if (typeof timeout === 'number') {
            const timer = setTimeout(() => {
              clearTimeout(timer)
              stopResolver.reject(
                new Error(`Instance "${name}" failed to stop in time.`),
              )
            }, timeout)
          }

          status = 'stopping'
          stop({
            emitter,
            status: this.status,
          })
            .then((...args) => {
              status = 'stopped'
              this.messages.clear()

              emitter.off('message', onMessage)
              emitter.off('listening', onListening)
              emitter.off('exit', onExit)

              startResolver = Promise.withResolvers<() => void>()
              stopResolver.resolve(...args)
            })
            .catch((error) => {
              status = 'started'
              stopResolver.reject(error)
            })

          return stopResolver.promise
        },
        async restart() {
          if (restarting) return restartResolver.promise

          restarting = true

          this.stop()
            .then(() => this.start.bind(this)())
            .then(() => restartResolver.resolve())
            .catch(restartResolver.reject)
            .finally(() => {
              restartResolver = Promise.withResolvers<void>()
              restarting = false
            })

          return restartResolver.promise
        },

        addListener: emitter.addListener.bind(emitter),
        off: emitter.off.bind(emitter),
        on: emitter.on.bind(emitter),
        once: emitter.once.bind(emitter),
        removeListener: emitter.removeListener.bind(emitter),
        removeAllListeners: emitter.removeAllListeners.bind(emitter),
      }
    }

    return Object.assign(create(), { create })
  }
}
