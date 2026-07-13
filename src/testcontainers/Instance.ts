import {
  GenericContainer,
  Network,
  PullPolicy,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from 'testcontainers'
import * as Instance from '../Instance.js'
import { command, type tempo as core_tempo } from '../instances/tempo.js'
import {
  type tempoZone as core_tempoZone,
  command as zoneCommand,
} from '../instances/tempoZone.js'
import * as ContainerOptions from './containerOptions.js'

export type { Instance, InstanceOptions } from '../Instance.js'

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
      host: args.host ?? 'localhost',
      name,
      port: args.port ?? 9545,
      async start({ port = args.port }, { emitter, setEndpoint }) {
        const containerPort = port ?? 9545
        // Mirrors the `zoneCommand` default; serves authenticated `eth_*` + `zone_*`.
        privateRpcPort =
          (args['privateRpc'] as { port?: number } | undefined)?.port ??
          containerPort + 3
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
            .withExposedPorts(containerPort, privateRpcPort)
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
              Wait.forHttp('/', privateRpcPort, {
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
              setEndpoint?.({
                host: started.getHost(),
                port: started.getMappedPort(containerPort),
              })
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
