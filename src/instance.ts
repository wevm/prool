import { EventEmitter } from 'eventemitter3'

type EventTypes = {
  message: [message: string]
  stderr: [message: string]
  stdout: [message: string]
}

type InstanceStartOptions_internal = { emitter: EventEmitter<EventTypes> }
type InstanceStopOptions_internal = { emitter: EventEmitter<EventTypes> }

export type InstanceStartOptions = {
  /**
   * Port to start the instance on.
   */
  port?: number | undefined
}

export type DefineInstanceFn<parameters> = (parameters: parameters) => Pick<
  Instance,
  'host' | 'name' | 'port'
> & {
  start(
    options: InstanceStartOptions & InstanceStartOptions_internal,
  ): Promise<void>
  stop(options: InstanceStopOptions_internal): Promise<void>
}

export type Instance = Pick<
  EventEmitter<EventTypes>,
  | 'addListener'
  | 'off'
  | 'on'
  | 'once'
  | 'removeAllListeners'
  | 'removeListener'
> & {
  /**
   * Name of the instance.
   *
   * @example "anvil"
   */
  name: string
  /**
   * Host of the instance.
   *
   * @example "127.0.0.1"
   */
  host: string
  /**
   * Set of messages emitted from the `"message"` event stored in-memory,
   * with length {@link InstanceOptions`messageBuffer`}.
   * Useful for debugging.
   *
   * @example ["Listening on http://127.0.0.1", "Started successfully."]
   */
  messages: { clear(): void; get(): string[] }
  /**
   * Port of the instance.
   *
   * @example 8545
   */
  port: number
  /**
   * Status of the instance.
   *
   * @default "idle"
   */
  status: 'idle' | 'stopped' | 'starting' | 'started' | 'stopping'
  /**
   * Starts the instance.
   *
   * @param options - Options for starting the instance.
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
export function defineInstance<parameters = undefined>(
  fn: DefineInstanceFn<parameters>,
) {
  return (
    ...[parametersOrOptions, options_]: parameters extends undefined
      ? [options?: InstanceOptions]
      : [parameters: parameters, options?: InstanceOptions]
  ): Instance => {
    const parameters = parametersOrOptions as parameters
    const options = options_ || parametersOrOptions || {}

    const { host, name, port, start, stop } = fn(parameters)
    const { messageBuffer = 20, timeout = 10_000 } = options

    let startResolver = Promise.withResolvers<() => void>()
    let stopResolver = Promise.withResolvers<void>()

    const emitter = new EventEmitter<EventTypes>()

    let messages: string[] = []
    let status: Instance['status'] = 'idle'

    function onMessage(message: string) {
      messages.push(message)
      if (messages.length > messageBuffer) messages.shift()
    }

    return {
      host,
      messages: {
        clear() {
          messages = []
        },
        get() {
          return messages
        },
      },
      name,
      port,
      get status() {
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

        status = 'starting'
        start({ emitter, port })
          .then(() => {
            status = 'started'

            stopResolver = Promise.withResolvers<void>()
            startResolver.resolve(this.stop)
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
        if (status !== 'started')
          throw new Error(
            `Instance "${name}" has not started. Status: ${status}`,
          )

        if (typeof timeout === 'number') {
          const timer = setTimeout(() => {
            clearTimeout(timer)
            stopResolver.reject(
              new Error(`Instance "${name}" failed to stop in time.`),
            )
          }, timeout)
        }

        status = 'stopping'
        stop({ emitter })
          .then((...args) => {
            status = 'stopped'
            this.messages.clear()
            emitter.off('message', onMessage)
            startResolver = Promise.withResolvers<() => void>()
            stopResolver.resolve(...args)
          })
          .catch(() => {
            status = 'started'
            stopResolver.reject()
          })

        return stopResolver.promise
      },

      addListener: emitter.addListener.bind(emitter),
      off: emitter.off.bind(emitter),
      on: emitter.on.bind(emitter),
      once: emitter.once.bind(emitter),
      removeListener: emitter.removeListener.bind(emitter),
      removeAllListeners: emitter.removeAllListeners.bind(emitter),
    }
  }
}
