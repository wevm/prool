import {
  Network as DockerNetwork,
  GenericContainer,
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
import { prepareGenesis } from '../internal/tempoGenesis.js'
import * as ContainerOptions from './containerOptions.js'
import * as Network from './Network.js'
import * as TempoId from './TempoId.js'

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
    genesis: transform,
    image = 'ghcr.io/tempoxyz/tempo:latest',
    hardfork,
    log: log_,
    pullPolicy,
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

      let genesis: string | undefined
      const prepared = hardfork !== undefined || transform !== undefined
      const chain = prepared ? '/tmp/prool-genesis.json' : args.chain
      if (prepared) {
        const exporter = await new GenericContainer(image)
          .withPullPolicy(ContainerOptions.resolvePullPolicy(pullPolicy))
          .withPlatform('linux/x86_64')
          .withAutoRemove(false)
          .withCommand(['-q', 'dump-genesis', '--chain', args.chain ?? 'dev'])
          .withWaitStrategy(Wait.forOneShotStartup())
          .withStartupTimeout(
            ContainerOptions.resolveStartupTimeout(startupTimeout),
          )
          .start()
        try {
          let output = ''
          for await (const chunk of await exporter.logs())
            output += chunk.toString()
          genesis = prepareGenesis(output, { hardfork, transform })
        } finally {
          await exporter.stop()
        }
      }

      const c = new GenericContainer(image)
        .withPullPolicy(ContainerOptions.resolvePullPolicy(pullPolicy))
        .withPlatform('linux/x86_64')
        .withExposedPorts(containerPort)
        .withExtraHosts([Network.hostGateway])
        .withName(containerName)
        .withEnvironment({ RUST_LOG })
        .withCommand(command({ ...args, chain, port: containerPort }))
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

      if (genesis !== undefined)
        c.withCopyContentToContainer([{ content: genesis, target: chain! }])

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
    Pick<core_tempo.Parameters, 'chain' | 'genesis' | 'hardfork'> &
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

/**
 * Defines a Tempo ID instance backed by the `id-dev` image: Tempo ID, its database, and an inbox
 * that returns each sign-in code (read it with `TempoId.code`).
 *
 * The container serves on `port` and publishes the same host port, since Tempo ID bakes its origin
 * (`http://localhost:${port}`) into every token's issuer. With `url`, starts no container and only
 * checks the health of the `id-dev` instance at that URL, which must hold the apps itself.
 *
 * Pulling `ghcr.io/tempoxyz/id-dev` needs `docker login ghcr.io` with access to the image.
 *
 * @example
 * ```ts
 * const instance = Instance.tempoId({
 *   apps: [{ clientId: 'my-app-e2e', name: 'My App', redirectUris: ['http://localhost:5173/callback'] }],
 *   rpcUrls: { local: { chainId: 1337, url: 'http://127.0.0.1:8545/1' } },
 *   url: process.env.TEMPO_ID_URL,
 * })
 * await instance.start()
 * const code = await TempoId.code({ email: 'alice@example.org', url: instance.url })
 * ```
 */
export const tempoId = Instance.define((parameters?: tempoId.Parameters) => {
  const {
    apps = [],
    containerName = `tempo-id.${crypto.randomUUID()}`,
    environment = {},
    image = 'ghcr.io/tempoxyz/id-dev:latest',
    log,
    port = 8787,
    pullPolicy,
    resources = [],
    rpcUrls = {},
    startupTimeout = 5 * 60_000,
    url,
  } = parameters || {}

  const external = url ? new URL(url) : undefined
  const endpoint = external
    ? {
        host: external.hostname,
        port: Number(
          external.port || (external.protocol === 'https:' ? 443 : 80),
        ),
        protocol: external.protocol === 'https:' ? 'https' : 'http',
      }
    : { host: 'localhost', port, protocol: 'http' }

  let container: StartedTestContainer | undefined

  return {
    _internal: { external: external !== undefined },
    endpoints: {
      default: endpoint as Instance.Endpoint<'http' | 'https'>,
    },
    host: endpoint.host,
    name: 'tempo-id',
    port: endpoint.port,
    async start(_, { emitter }) {
      if (external) {
        if (await TempoId.healthy(external.origin)) return
        throw new Error(
          `Tempo ID at ${external.origin} failed its health check. Start an \`id-dev\` instance there, or unset \`url\`.`,
        )
      }

      container = await new GenericContainer(image)
        .withPullPolicy(ContainerOptions.resolvePullPolicy(pullPolicy))
        .withName(containerName)
        .withEnvironment({
          ...environment,
          ID_DEV_APPS: JSON.stringify(apps),
          ID_DEV_RESOURCES: JSON.stringify(resources),
          PORT: String(port),
          ...(Object.keys(rpcUrls).length > 0
            ? {
                RPC_URLS: Object.entries(rpcUrls)
                  .map(
                    ([name, { chainId, url }]) =>
                      `${name}:${chainId}=${Network.reachable(url)}`,
                  )
                  .join(','),
              }
            : {}),
        })
        .withExposedPorts({ container: port, host: port })
        .withExtraHosts([Network.hostGateway])
        .withLogConsumer((stream) => {
          stream.on('data', (data) => {
            const message = data.toString()
            emitter.emit('message', message)
            emitter.emit('stdout', message)
            if (log) console.log(message)
          })
          stream.on('error', (error) => {
            if (log) console.error(error.message)
            emitter.emit('message', error.message)
            emitter.emit('stderr', error.message)
          })
        })
        // Each start applies the migrations.
        .withStartupTimeout(startupTimeout)
        .withWaitStrategy(
          Wait.forHttp('/__id-dev/health', port).forStatusCode(204),
        )
        .start()
    },
    async stop() {
      if (!container) return
      await container.stop()
      container = undefined
    },
  }
})

export declare namespace tempoId {
  export type Parameters = Omit<
    ContainerOptions.Parameters,
    'startupTimeout'
  > & {
    /** Apps that Tempo ID registers at its start (`ID_DEV_APPS`). @default [] */
    apps?: readonly TempoId.App[] | undefined
    /** Name of the container. */
    containerName?: string | undefined
    /**
     * Extra container environment, such as `CONFIGURABLE_ACCOUNTS`, `SECRET`, or
     * `TEMPO_API_URLS`. The other parameters take precedence.
     */
    environment?: Record<string, string> | undefined
    /**
     * Docker image to use.
     * @default "ghcr.io/tempoxyz/id-dev:latest"
     */
    image?: string | undefined
    /** Whether to print the container's logs. */
    log?: boolean | undefined
    /**
     * Port the container serves on, and publishes on the same host port.
     * @default 8787
     */
    port?: number | undefined
    /** Resources that Tempo ID registers after the apps (`ID_DEV_RESOURCES`). @default [] */
    resources?: readonly TempoId.Resource[] | undefined
    /**
     * Extra chains by name (`RPC_URLS`). Loopback URLs are rewritten to `host.docker.internal`
     * so the container reaches the host.
     *
     * @example { local: { chainId: 1337, url: 'http://127.0.0.1:8545/1' } }
     */
    rpcUrls?: Record<string, { chainId: number; url: string }> | undefined
    /**
     * Startup timeout in milliseconds, which covers the migrations.
     * @default 300_000
     */
    startupTimeout?: number | undefined
    /**
     * URL of a running `id-dev` instance. When set, starts no container and only checks its
     * health.
     */
    url?: string | undefined
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
      pullPolicy,
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
            network = await new DockerNetwork().start()
            l1Container = await new GenericContainer(
              l1Parameters?.image ?? 'ghcr.io/tempoxyz/tempo:latest',
            )
              .withPullPolicy(ContainerOptions.resolvePullPolicy(pullPolicy))
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
            .withPullPolicy(ContainerOptions.resolvePullPolicy(pullPolicy))
            // The public image currently publishes only linux/amd64.
            .withPlatform('linux/amd64')
            .withExposedPorts(containerPort, effectivePrivateRpcPort)
            .withExtraHosts([Network.hostGateway])
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
