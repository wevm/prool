import {
  GenericContainer,
  Network,
  PullPolicy,
  type StartedNetwork,
  type StartedTestContainer,
  type TestContainer,
  Wait,
} from 'testcontainers'
import * as Instance from '../Instance.js'
import { command, type tempo as core_tempo } from '../instances/tempo.js'
import {
  type tempoZone as core_tempoZone,
  command as zoneCommand,
} from '../instances/tempoZone.js'
import * as ContainerOptions from './containerOptions.js'

export type { Endpoint, Instance, InstanceOptions } from '../Instance.js'

/**
 * Defines an instance backed by a Docker Compose environment.
 *
 * @example
 * ```ts
 * const instance = Instance.compose({
 *   name: 'services',
 *   environment: () => new DockerComposeEnvironment('.', 'compose.yml'),
 *   services: ['api'],
 *   endpoints: {
 *     default: { container: 'api-1', protocol: 'http', port: 8080 },
 *   },
 * })
 * const pool = Pool.define({ instance })
 * await pool.start(Number(process.env.VITEST_POOL_ID ?? 1))
 * ```
 */
export function compose<
  const endpointDefinitions extends compose.EndpointDefinitions,
>(
  parameters: compose.Parameters<endpointDefinitions>,
  options?: Instance.InstanceOptions,
): Instance.Instance<undefined, compose.Endpoints<endpointDefinitions>> {
  const down = composeDownOptions(parameters.down)
  const initialEndpoints = Object.fromEntries(
    Object.entries(parameters.endpoints).flatMap(([name, endpoint]) =>
      endpoint
        ? [
            [
              name,
              {
                host: 'localhost',
                port: endpoint.port,
                protocol: endpoint.protocol,
              },
            ],
          ]
        : [],
    ),
  ) as compose.Endpoints<endpointDefinitions>

  const definition = Instance.define<
    undefined,
    undefined,
    compose.Endpoints<endpointDefinitions>
  >(() => {
    let environment: compose.StartedEnvironment | undefined

    async function stopEnvironment() {
      if (!environment) return
      const started = environment
      await started.down(down)
      if (environment === started) environment = undefined
    }

    return {
      endpoints: initialEndpoints,
      host: initialEndpoints.default.host,
      name: parameters.name,
      port: initialEndpoints.default.port,
      async start(_, { setEndpoint }) {
        await stopEnvironment()
        const started = await parameters
          .environment()
          .up(parameters.services ? [...parameters.services] : undefined)
        environment = started

        try {
          const endpoints = Object.entries(parameters.endpoints).flatMap(
            ([name, definition]) => {
              if (!definition) return []
              const container = started.getContainer(definition.container)
              return [
                [
                  name,
                  {
                    host: container.getHost(),
                    port: container.getMappedPort(definition.port),
                    protocol: definition.protocol,
                  },
                ] as const,
              ]
            },
          )
          const applyEndpoint = setEndpoint as
            | ((name: string, endpoint: Instance.Endpoint) => void)
            | undefined
          for (const [name, endpoint] of endpoints)
            applyEndpoint?.(name, endpoint)
        } catch (error) {
          const [result] = await Promise.allSettled([started.down(down)])
          if (result?.status === 'fulfilled') environment = undefined
          throw error
        }
      },
      async stop() {
        await stopEnvironment()
      },
    }
  })

  return definition(options)
}

export declare namespace compose {
  export type EndpointDefinition<
    protocol extends Instance.Endpoint.Protocol = Instance.Endpoint.Protocol,
  > = {
    container: string
    port: number
    protocol: protocol
  }

  export type EndpointDefinitions = {
    default: EndpointDefinition
    [name: string]: EndpointDefinition | undefined
  }

  export type Endpoints<definitions extends EndpointDefinitions> = {
    default: Instance.Endpoint<definitions['default']['protocol']>
  } & {
    [name in Exclude<keyof definitions, 'default'>]: Endpoint<definitions[name]>
  }

  export type Endpoint<definition extends EndpointDefinition | undefined> =
    definition extends EndpointDefinition
      ? Instance.Endpoint<definition['protocol']>
      : undefined

  export type DownOptions = {
    /** Removes Compose volumes. */
    removeVolumes?: boolean | undefined
    /** Grace period in milliseconds. Zero kills containers immediately. */
    timeout?: number | undefined
  }

  export type Environment = {
    up(services?: string[] | undefined): Promise<StartedEnvironment>
  }

  export type Parameters<definitions extends EndpointDefinitions> = {
    /** Options passed to `docker compose down`. */
    down?: DownOptions | undefined
    /** Container ports exposed as named instance endpoints. */
    endpoints: definitions
    /** Creates a fresh Compose environment for each pooled instance. */
    environment: () => Environment
    /** Instance name reported by Prool. */
    name: string
    /** Compose services to start. Dependencies start automatically. */
    services?: readonly string[] | undefined
  }

  export type StartedEnvironment = {
    down(options?: DownOptions | undefined): Promise<unknown>
    getContainer(name: string): {
      getHost(): string
      getMappedPort(port: number): number
    }
  }
}

function composeDownOptions(options: compose.DownOptions | undefined) {
  if (options?.timeout !== 0) return options
  // Testcontainers omits zero; one millisecond becomes Compose's zero-second grace.
  return { ...options, timeout: 1 }
}

/**
 * Defines an instance backed by a Testcontainers container.
 *
 * @example
 * ```ts
 * const instance = Instance.testcontainer({
 *   name: 'service',
 *   container: () => new GenericContainer('service:latest'),
 *   endpoints: {
 *     default: { protocol: 'http', port: 8080 },
 *     metrics: { protocol: 'http', port: 9090 },
 *   },
 * })
 * ```
 */
export function testcontainer<
  const endpointDefinitions extends testcontainer.EndpointDefinitions,
>(
  parameters: testcontainer.Parameters<endpointDefinitions>,
  options?: Instance.InstanceOptions,
): Instance.Instance<undefined, testcontainer.Endpoints<endpointDefinitions>> {
  const ports = [
    ...new Set(
      Object.values(parameters.endpoints).map((endpoint) => endpoint.port),
    ),
  ]
  const initialEndpoints = Object.fromEntries(
    Object.entries(parameters.endpoints).map(([name, endpoint]) => [
      name,
      {
        host: 'localhost',
        port: endpoint.port,
        protocol: endpoint.protocol,
      },
    ]),
  ) as testcontainer.Endpoints<endpointDefinitions>

  const definition = Instance.define<
    undefined,
    undefined,
    testcontainer.Endpoints<endpointDefinitions>
  >(() => {
    let container: StartedTestContainer | undefined

    async function stopContainer() {
      if (!container) return
      const started = container
      await started.stop()
      if (container === started) container = undefined
    }

    return {
      endpoints: initialEndpoints,
      host: initialEndpoints.default.host,
      name: parameters.name,
      port: initialEndpoints.default.port,
      async start(_, { setEndpoint }) {
        await stopContainer()
        const started = await parameters
          .container()
          .withExposedPorts(...ports)
          .start()
        container = started

        try {
          const host = started.getHost()
          const endpoints = Object.entries(parameters.endpoints).map(
            ([name, definition]) =>
              [
                name,
                {
                  host,
                  port: started.getMappedPort(definition.port),
                  protocol: definition.protocol,
                },
              ] as const,
          )
          const applyEndpoint = setEndpoint as
            | ((name: string, endpoint: Instance.Endpoint) => void)
            | undefined
          for (const [name, endpoint] of endpoints)
            applyEndpoint?.(name, endpoint)
        } catch (error) {
          const [result] = await Promise.allSettled([started.stop()])
          if (result?.status === 'fulfilled') container = undefined
          throw error
        }
      },
      async stop() {
        await stopContainer()
      },
    }
  })

  return definition(options)
}

export declare namespace testcontainer {
  export type EndpointDefinition<
    protocol extends Instance.Endpoint.Protocol = Instance.Endpoint.Protocol,
  > = {
    port: number
    protocol: protocol
  }

  export type EndpointDefinitions = {
    default: EndpointDefinition
    [name: string]: EndpointDefinition
  }

  export type Endpoints<definitions extends EndpointDefinitions> = {
    [name in keyof definitions]: Instance.Endpoint<
      definitions[name]['protocol']
    >
  }

  export type Parameters<definitions extends EndpointDefinitions> = {
    container: () => TestContainer
    endpoints: definitions
    name: string
  }
}

/**
 * Defines a Tempo instance.
 *
 * @example
 * ```ts
 * const instance = Instance.tempo({ port: 8545 })
 * await instance.start()
 * // ...
 * await instance.stop()
 * ```
 */
export const tempo = Instance.define((parameters?: tempo.Parameters) => {
  const {
    containerName = `tempo.${crypto.randomUUID()}`,
    image = 'ghcr.io/tempoxyz/tempo:latest',
    log: log_,
    startupTimeout,
    ...args
  } = parameters || {}

  const log = (() => {
    try {
      return JSON.parse(log_ as string)
    } catch {
      return log_
    }
  })()
  const RUST_LOG = log && typeof log !== 'boolean' ? log : ''

  const name = 'tempo'
  let container: StartedTestContainer | undefined

  return {
    _internal: {
      args,
    },
    host: args.host ?? 'localhost',
    name,
    port: args.port ?? 8545,
    async start({ port = args.port }, { emitter, setEndpoint }) {
      const promise = Promise.withResolvers<void>()

      const containerPort = port ?? 8545

      const c = new GenericContainer(image)
        .withPullPolicy(PullPolicy.alwaysPull())
        .withPlatform('linux/x86_64')
        .withExposedPorts(containerPort)
        .withExtraHosts([
          { host: 'host.docker.internal', ipAddress: 'host-gateway' },
        ])
        .withName(containerName)
        .withEnvironment({ RUST_LOG })
        .withCommand(command({ ...args, port: containerPort }))
        .withWaitStrategy(
          Wait.forLogMessage(
            /Received (block|new payload) from consensus engine/,
          ),
        )
        .withLogConsumer((stream) => {
          stream.on('data', (data) => {
            const message = data.toString()
            emitter.emit('message', message)
            emitter.emit('stdout', message)
            if (log) console.log(message)
            if (message.includes('shutting down'))
              promise.reject(new Error(`Failed to start: ${message}`))
          })
          stream.on('error', (error) => {
            if (log) console.error(error.message)
            emitter.emit('message', error.message)
            emitter.emit('stderr', error.message)
            promise.reject(new Error(`Failed to start: ${error.message}`))
          })
        })
        .withStartupTimeout(
          ContainerOptions.resolveStartupTimeout(startupTimeout),
        )

      c.start()
        .then((started) => {
          container = started
          setEndpoint?.({
            host: started.getHost(),
            port: started.getMappedPort(containerPort),
          })
          promise.resolve()
        })
        .catch(promise.reject)

      return promise.promise
    },
    async stop() {
      if (!container) return
      await container.stop()
      container = undefined
    },
  }
})

export declare namespace tempo {
  export type Parameters = Omit<core_tempo.Parameters, 'binary'> &
    ContainerOptions.Parameters & {
      /**
       * Name of the container.
       */
      containerName?: string | undefined
      /**
       * Docker image to use.
       */
      image?: string | undefined
      /**
       * Host the server will listen on.
       */
      host?: string | undefined
      /**
       * Port the server will listen on.
       */
      port?: number | undefined
    }
}

const tempoZoneStartupTimeout = 120_000

/**
 * Defines a Tempo Zone instance.
 *
 * Starts a Tempo dev L1 and `tempo-zone dev` on a shared network. An external
 * `l1.rpcUrl` must be container-reachable, mine canonical headers, and fund
 * the configured dev key with pathUSD.
 *
 * @example
 * ```ts
 * const instance = Instance.tempoZone({ port: 9545 })
 * await instance.start()
 * // ...
 * await instance.stop()
 * ```
 */
export const tempoZone = Instance.define(
  (parameters?: tempoZone.Parameters) => {
    const {
      containerName = `tempo-zone.${crypto.randomUUID()}`,
      image = 'ghcr.io/tempoxyz/tempo-zone:latest',
      l1: l1Parameters,
      log: log_,
      startupTimeout,
      ...args
    } = parameters || {}

    const log = (() => {
      try {
        return JSON.parse(log_ as string)
      } catch {
        return log_
      }
    })()
    const RUST_LOG = log && typeof log !== 'boolean' ? log : ''
    const L1_RUST_LOG = RUST_LOG
      ? `${RUST_LOG},reth_node_events=info`
      : RUST_LOG

    // L1 ports inside the container (only reachable over the shared network).
    const l1HttpPort = 8545
    const l1WsPort = 8546

    const name = 'tempo-zone'
    let container: StartedTestContainer | undefined
    let l1Container: StartedTestContainer | undefined
    let network: StartedNetwork | undefined
    let privateRpcPort: number | undefined

    async function teardown() {
      if (container) await container.stop().catch(() => {})
      if (l1Container) await l1Container.stop().catch(() => {})
      if (network) await network.stop().catch(() => {})
      container = undefined
      l1Container = undefined
      network = undefined
      privateRpcPort = undefined
    }

    return {
      _internal: {
        args,
        get l1() {
          if (!l1Container) return undefined
          return {
            host: l1Container.getHost(),
            port: l1Container.getMappedPort(l1HttpPort),
            wsPort: l1Container.getMappedPort(l1WsPort),
          }
        },
        get privateRpc() {
          if (!container || !privateRpcPort) return undefined
          return {
            host: container.getHost(),
            port: container.getMappedPort(privateRpcPort),
          }
        },
      },
      endpoints: {
        default: {
          host: args.host ?? 'localhost',
          port: args.port ?? 9545,
          protocol: 'http' as const,
        },
        l1: undefined as Instance.Endpoint<'ws'> | undefined,
        privateRpc: {
          host: args.host ?? 'localhost',
          port:
            (args['privateRpc'] as { port?: number } | undefined)?.port ??
            (args.port ?? 9545) + 3,
          protocol: 'http' as const,
        },
      },
      host: args.host ?? 'localhost',
      name,
      port: args.port ?? 9545,
      async start({ port = args.port }, { emitter, setEndpoint }) {
        const containerPort = port ?? 9545
        // Mirrors the `zoneCommand` default; serves authenticated `eth_*` + `zone_*`.
        const effectivePrivateRpcPort =
          (args['privateRpc'] as { port?: number } | undefined)?.port ??
          containerPort + 3
        privateRpcPort = effectivePrivateRpcPort
        const timeout = startupTimeout ?? tempoZoneStartupTimeout
        const includeL1Log = (message: string) => {
          if (log !== 'warn' && log !== 'error') return true
          return !/INFO.*reth_node_events::node/.test(message)
        }

        const logConsumer =
          (
            reject: (error: Error) => void,
            include: (message: string) => boolean = () => true,
          ) =>
          (stream: NodeJS.ReadableStream) => {
            stream.on('data', (data) => {
              const message = data.toString()
              if (!include(message)) return
              emitter.emit('message', message)
              emitter.emit('stdout', message)
              if (log) console.log(message)
              if (message.includes('shutting down'))
                reject(new Error(`Failed to start: ${message}`))
            })
            stream.on('error', (error) => {
              if (log) console.error(error.message)
              emitter.emit('message', error.message)
              emitter.emit('stderr', error.message)
              reject(new Error(`Failed to start: ${error.message}`))
            })
          }

        try {
          // Start a dev L1 on a shared network unless attaching to an existing one.
          let l1RpcUrl = l1Parameters?.rpcUrl
          if (!l1RpcUrl) {
            network = await new Network().start()
            l1Container = await new GenericContainer(
              l1Parameters?.image ?? 'ghcr.io/tempoxyz/tempo:latest',
            )
              .withPullPolicy(PullPolicy.alwaysPull())
              .withPlatform('linux/amd64')
              .withNetwork(network)
              .withNetworkAliases('l1')
              .withExposedPorts(l1HttpPort, l1WsPort)
              .withName(`${containerName}.l1`)
              .withEnvironment({ RUST_LOG: L1_RUST_LOG })
              .withCommand(
                command({
                  port: l1HttpPort,
                  // The zone anchors to the L1 over WebSocket.
                  ws: [true, { addr: '0.0.0.0', api: 'all', port: l1WsPort }],
                }),
              )
              .withWaitStrategy(
                Wait.forLogMessage(
                  /Received (block|new payload) from consensus engine/,
                ),
              )
              .withLogConsumer(
                logConsumer(() => {
                  // L1 shutdown surfaces via the zone container failing to start.
                }, includeL1Log),
              )
              .withStartupTimeout(timeout)
              .start()
            l1RpcUrl = `ws://l1:${l1WsPort}`
          }

          const promise = Promise.withResolvers<void>()

          let c = new GenericContainer(image)
            .withPullPolicy(PullPolicy.alwaysPull())
            // The public image currently publishes only linux/amd64.
            .withPlatform('linux/amd64')
            .withExposedPorts(containerPort, effectivePrivateRpcPort)
            .withExtraHosts([
              { host: 'host.docker.internal', ipAddress: 'host-gateway' },
            ])
            .withName(containerName)
            .withEnvironment({ RUST_LOG })
            .withCommand(
              zoneCommand({
                ...args,
                l1: {
                  ...(l1Parameters?.factoryAddress
                    ? { factoryAddress: l1Parameters.factoryAddress }
                    : {}),
                  rpcUrl: l1RpcUrl,
                },
                port: containerPort,
              }),
            )
            .withWaitStrategy(
              Wait.forHttp('/', effectivePrivateRpcPort, {
                abortOnContainerExit: true,
              })
                .withMethod('POST')
                .forStatusCode(401),
            )
            .withLogConsumer(logConsumer(promise.reject))
            .withStartupTimeout(timeout)
          if (network) c = c.withNetwork(network)

          c.start()
            .then((started) => {
              container = started
              const host = started.getHost()
              const defaultEndpoint = {
                host,
                port: started.getMappedPort(containerPort),
              }
              const privateRpcEndpoint = {
                host,
                port: started.getMappedPort(effectivePrivateRpcPort),
                protocol: 'http' as const,
              }
              const l1Endpoint = l1Container
                ? {
                    host: l1Container.getHost(),
                    port: l1Container.getMappedPort(l1WsPort),
                    protocol: 'ws' as const,
                  }
                : undefined

              setEndpoint?.(defaultEndpoint)
              setEndpoint?.('privateRpc', privateRpcEndpoint)
              if (l1Endpoint) setEndpoint?.('l1', l1Endpoint)
              promise.resolve()
            })
            .catch(promise.reject)

          await promise.promise
        } catch (error) {
          await teardown()
          throw error
        }
      },
      async stop() {
        await teardown()
      },
    }
  },
)

export declare namespace tempoZone {
  export type Parameters = Omit<core_tempoZone.Parameters, 'binary' | 'l1'> &
    Omit<ContainerOptions.Parameters, 'startupTimeout'> & {
      /**
       * Name of the container.
       */
      containerName?: string | undefined
      /**
       * Docker image to use for the zone node.
       * @default "ghcr.io/tempoxyz/tempo-zone:latest"
       */
      image?: string | undefined
      /**
       * Startup timeout for each L1 and zone readiness check, in milliseconds.
       * @default 120_000
       */
      startupTimeout?: number | undefined
      /**
       * Host the server will listen on.
       */
      host?: string | undefined
      /**
       * Tempo L1 options.
       */
      l1?:
        | (NonNullable<core_tempoZone.Parameters['l1']> & {
            /**
             * Docker image to use for the L1 node (when no `rpcUrl` is provided).
             */
            image?: string | undefined
            /**
             * Existing Tempo L1 WebSocket RPC URL, reachable from inside the
             * container (e.g. `ws://host.docker.internal:8546`). Starts a
             * dev L1 container when omitted.
             * Anvil requires Foundry 1.8 or newer.
             */
            rpcUrl?: string | undefined
          })
        | undefined
      /**
       * Port the server will listen on.
       */
      port?: number | undefined
    }
}
