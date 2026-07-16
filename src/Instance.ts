import { EventEmitter } from 'eventemitter3'

export { alto } from './instances/alto.js'
export { anvil } from './instances/anvil.js'
export { tempo } from './instances/tempo.js'
export { tempoZone } from './instances/tempoZone.js'

type EventTypes = {
  exit: [code: number | null, signal: NodeJS.Signals | null]
  listening: []
  message: [message: string]
  stderr: [message: string]
  stdout: [message: string]
}

export type Endpoint<protocol extends Endpoint.Protocol = Endpoint.Protocol> = {
  /** Host the endpoint is available on. */
  host: string
  /** Port the endpoint is available on. */
  port: number
  /** Transport protocol used by the endpoint. */
  protocol: protocol
}

export declare namespace Endpoint {
  export type Protocol = 'http' | 'https' | 'tcp' | 'ws' | 'wss'
}

type EndpointMap = Record<string, Endpoint | undefined>

type InstanceEndpoints<endpoints extends EndpointMap> = Readonly<
  {
    default: endpoints extends { default: infer endpoint extends Endpoint }
      ? endpoint
      : Endpoint
  } & Omit<endpoints, 'default'>
>

export type Instance<
  _internal extends object | undefined = object | undefined,
  endpoints extends EndpointMap = EndpointMap,
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
  ): Omit<Instance<_internal, endpoints>, 'create'>
  /** Named endpoints. `host` and `port` alias `default`. */
  endpoints: InstanceEndpoints<endpoints>
  /** Returns endpoint metadata by name. */
  endpoint<name extends keyof InstanceEndpoints<endpoints>>(
    name: name,
  ): InstanceEndpoints<endpoints>[name]
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
  endpoints extends EndpointMap = {},
>(
  fn: define.DefineFn<parameters, _internal, endpoints>,
): define.ReturnType<_internal, parameters, endpoints> {
  return (...[parametersOrOptions, options_]) => {
    function create(
      createParameters: { port?: number | undefined } = {},
    ): Omit<Instance<_internal, endpoints>, 'create'> {
      const parameters = parametersOrOptions as parameters
      const options = options_ || parametersOrOptions || {}

      const instance = fn(parameters)
      const { _internal, name, start, stop } = {
        ...instance,
        ...createParameters,
      }
      const initialEndpoints = instance.endpoints as EndpointMap | undefined
      const endpointMap: EndpointMap & { default: Endpoint } = {
        ...initialEndpoints,
        default: {
          host: initialEndpoints?.['default']?.host ?? instance.host,
          port:
            createParameters.port ??
            initialEndpoints?.['default']?.port ??
            instance.port,
          protocol: initialEndpoints?.['default']?.protocol ?? 'http',
        },
      }
      const setEndpoint = ((
        ...args:
          | [endpoint: Partial<Endpoint>]
          | [name: string, endpoint: Endpoint]
      ) => {
        if (typeof args[0] === 'string') {
          endpointMap[args[0]] = args[1]
          return
        }
        endpointMap.default = {
          ...endpointMap.default,
          ...args[0],
        }
      }) as define.SetEndpoint<endpoints>
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
        get host() {
          return endpointMap.default.host
        },
        name,
        get port() {
          return endpointMap.default.port
        },
        endpoints: endpointMap as InstanceEndpoints<endpoints>,
        endpoint(name) {
          return endpointMap[
            name as string
          ] as InstanceEndpoints<endpoints>[typeof name]
        },
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

          const resolver = Promise.withResolvers<() => void>()
          startResolver = resolver

          let timer: NodeJS.Timeout | undefined
          if (typeof timeout === 'number') {
            timer = setTimeout(() => {
              resolver.reject(
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
              port: endpointMap.default.port,
            },
            {
              emitter,
              setEndpoint,
              status: this.status,
            },
          )
            .then(() => {
              if (timer) clearTimeout(timer)
              status = 'started'

              stopResolver = Promise.withResolvers<void>()
              resolver.resolve(this.stop.bind(this))
            })
            .catch((error) => {
              if (timer) clearTimeout(timer)
              status = 'idle'
              this.messages.clear()
              emitter.off('message', onMessage)
              resolver.reject(error)
            })

          return resolver.promise
        },
        async stop() {
          if (status === 'stopping') return stopResolver.promise
          if (status === 'starting')
            throw new Error(`Instance "${name}" is starting.`)

          const resolver = Promise.withResolvers<void>()
          stopResolver = resolver

          let timer: NodeJS.Timeout | undefined
          if (typeof timeout === 'number') {
            timer = setTimeout(() => {
              resolver.reject(
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
              if (timer) clearTimeout(timer)
              status = 'stopped'
              this.messages.clear()

              emitter.off('message', onMessage)
              emitter.off('listening', onListening)
              emitter.off('exit', onExit)

              startResolver = Promise.withResolvers<() => void>()
              resolver.resolve(...args)
            })
            .catch((error) => {
              if (timer) clearTimeout(timer)
              status = 'started'
              resolver.reject(error)
            })

          return resolver.promise
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
    endpoints extends EndpointMap = {},
  > = (parameters: parameters) => Pick<Instance, 'host' | 'name' | 'port'> & {
    _internal?: _internal | undefined
    endpoints?: endpoints | undefined
    start(
      options: InstanceStartOptions,
      options_internal: InstanceStartOptions_internal<endpoints>,
    ): Promise<void>
    stop(options_internal: InstanceStopOptions_internal): Promise<void>
  }

  export type ReturnType<
    _internal extends object | undefined = object | undefined,
    parameters = undefined,
    endpoints extends EndpointMap = {},
  > = (
    ...parameters: parameters extends undefined
      ? [options?: InstanceOptions]
      : [parameters: parameters, options?: InstanceOptions]
  ) => Instance<_internal, endpoints>

  export type SetEndpoint<endpoints extends EndpointMap = EndpointMap> = {
    (endpoint: Partial<InstanceEndpoints<endpoints>['default']>): void
    <name extends keyof endpoints & string>(
      name: name,
      endpoint: Exclude<endpoints[name], undefined>,
    ): void
  }

  export type InstanceStartOptions_internal<
    endpoints extends EndpointMap = EndpointMap,
  > = {
    emitter: EventEmitter<EventTypes>
    setEndpoint?: SetEndpoint<endpoints>
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
