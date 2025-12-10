import { EventEmitter } from 'eventemitter3'

export { alto } from './instances/alto.js'
export { anvil } from './instances/anvil.js'
export { tempo, tempoDocker } from './instances/tempo.js'

type EventTypes = {
  exit: [code: number | null, signal: NodeJS.Signals | null]
  listening: []
  message: [message: string]
  stderr: [message: string]
  stdout: [message: string]
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

/**
 * Creates an instance definition.
 *
 * @param fn - Function to define the instance.
 *
 * @example
 * ```ts
 * const foo = Instance.define((parameters: FooParameters) => {
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
export function define<
  _internal extends object | undefined,
  parameters = undefined,
>(
  fn: define.DefineFn<parameters, _internal>,
): define.ReturnType<_internal, parameters> {
  return (...[parametersOrOptions, options_]) => {
    function create(createParameters: Parameters<Instance['create']>[0] = {}) {
      const parameters = parametersOrOptions as parameters
      const options = options_ || parametersOrOptions || {}

      const instance = fn(parameters)
      const { _internal, host, name, port, start, stop } = {
        ...instance,
        ...createParameters,
        port: createParameters.port ?? instance.port,
      }
      const { messageBuffer = 20, timeout } = options

      let restartResolver = Promise.withResolvers<void>()

      const emitter = new EventEmitter<EventTypes>()

      let messages: string[] = []
      let status: Instance['status'] = 'idle'
      let restarting = false

      let currentStart: {
        promise: Promise<() => void>
        resolve: (fn: () => void) => void
        reject: (err: unknown) => void
        timer?: NodeJS.Timeout
      } | null = null

      let currentStop: {
        promise: Promise<void>
        resolve: () => void
        reject: (err: unknown) => void
        timer?: NodeJS.Timeout
      } | null = null

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
          if (status === 'starting' && currentStart) return currentStart.promise
          if (status !== 'idle' && status !== 'stopped')
            throw new Error(
              `Instance "${name}" is not in an idle or stopped state. Status: ${status}`,
            )

          const { promise, resolve, reject } =
            Promise.withResolvers<() => void>()
          currentStart = { promise, resolve, reject }

          if (typeof timeout === 'number') {
            const timer = setTimeout(() => {
              if (currentStart?.promise === promise) {
                currentStart.reject(
                  new Error(`Instance "${name}" failed to start in time.`),
                )
                currentStart = null
              }
            }, timeout)
            currentStart.timer = timer
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

              if (currentStart?.timer) clearTimeout(currentStart.timer)
              currentStart?.resolve(this.stop.bind(this))
              currentStart = null
            })
            .catch((error) => {
              status = 'idle'
              this.messages.clear()
              emitter.off('message', onMessage)

              if (currentStart?.timer) clearTimeout(currentStart.timer)
              currentStart?.reject(error)
              currentStart = null
            })

          return promise
        },
        async stop() {
          if (status === 'stopping' && currentStop) return currentStop.promise
          if (status === 'starting')
            throw new Error(`Instance "${name}" is starting.`)

          const { promise, resolve, reject } = Promise.withResolvers<void>()
          currentStop = { promise, resolve, reject }

          if (typeof timeout === 'number') {
            const timer = setTimeout(() => {
              if (currentStop?.promise === promise) {
                currentStop.reject(
                  new Error(`Instance "${name}" failed to stop in time.`),
                )
                currentStop = null
              }
            }, timeout)
            currentStop.timer = timer
          }

          status = 'stopping'
          stop({
            emitter,
            status: this.status,
          })
            .then(() => {
              status = 'stopped'
              this.messages.clear()

              emitter.off('message', onMessage)
              emitter.off('listening', onListening)
              emitter.off('exit', onExit)

              if (currentStop?.timer) clearTimeout(currentStop.timer)
              currentStop?.resolve()
              currentStop = null
            })
            .catch((error) => {
              status = 'started'

              if (currentStop?.timer) clearTimeout(currentStop.timer)
              currentStop?.reject(error)
              currentStop = null
            })

          return promise
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

export declare namespace define {
  export type DefineFn<
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

  export type ReturnType<
    _internal extends object | undefined = object | undefined,
    parameters = undefined,
  > = (
    ...parameters: parameters extends undefined
      ? [options?: InstanceOptions]
      : [parameters: parameters, options?: InstanceOptions]
  ) => Instance<_internal>

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
}
