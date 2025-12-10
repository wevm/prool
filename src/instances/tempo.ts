import * as os from 'node:os'
import * as path from 'node:path'
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers'
import * as Instance from '../Instance.js'

/**
 * Defines a Tempo instance.
 *
 * @example
 * ```ts
 * const instance = tempo({ port: 8545 })
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
    async start({ port = args.port }, { emitter }) {
      const promise = Promise.withResolvers<void>()

      const dataDir = path.join(os.tmpdir(), '.prool', containerName)
      const c = new GenericContainer(image)
        .withPlatform('linux/x86_64')
        .withNetworkMode('host')
        .withExtraHosts([
          { host: 'host.docker.internal', ipAddress: 'host-gateway' },
          { host: 'localhost', ipAddress: 'host-gateway' },
        ])
        .withName(containerName)
        .withEnvironment({ RUST_LOG })
        .withCommand([
          'node',
          `--authrpc.port=${port! + 30}`,
          `--datadir=${dataDir}`,
          '--dev',
          `--dev.block-time=${parameters?.blockTime ?? '50ms'}`,
          '--engine.disable-precompile-cache',
          '--engine.legacy-state-root',
          '--faucet.address',
          ...(parameters?.faucet?.addresses ?? [
            '0x20c0000000000000000000000000000000000000',
            '0x20c0000000000000000000000000000000000001',
            '0x20c0000000000000000000000000000000000002',
            '0x20c0000000000000000000000000000000000003',
          ]),
          `--faucet.amount=${parameters?.faucet?.amount ?? '1000000000000'}`,
          '--faucet.enabled',
          `--faucet.private-key=${parameters?.faucet?.privateKey ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'}`,
          '--http',
          '--http.addr=0.0.0.0',
          '--http.api=all',
          '--http.corsdomain=*',
          `--http.port=${port!}`,
          `--port=${port! + 10}`,
          '--txpool.basefee-max-count=10000000000000',
          '--txpool.basefee-max-size=10000',
          '--txpool.max-account-slots=500000',
          '--txpool.pending-max-count=10000000000000',
          '--txpool.pending-max-size=10000',
          '--txpool.queued-max-count=10000000000000',
          '--txpool.queued-max-size=10000',
          `--ws.port=${port! + 20}`,
        ])
        .withWaitStrategy(Wait.forLogMessage(/RPC HTTP server started/))
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
        .withStartupTimeout(120_000)

      c.start()
        .then((c) => {
          container = c
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
  export type Parameters = {
    /**
     * Interval between blocks.
     */
    blockTime?: string | undefined
    /**
     * Name of the container.
     */
    containerName?: string | undefined
    /**
     * Chain this node is running.
     */
    chain?: string | undefined
    /**
     * Docker image to use.
     */
    image?: string | undefined
    /**
     * Faucet options.
     */
    faucet?:
      | {
          /**
           * Target token addresses for the faucet to be funding with
           */
          addresses?: string[] | undefined
          /**
           * Amount for each faucet funding transaction
           */
          amount?: bigint | undefined
          /**
           * Faucet funding mnemonic
           */
          privateKey?: string | undefined
        }
      | undefined
    /**
     * Rust log level configuration (sets RUST_LOG environment variable).
     * Can be a log level or a custom filter string.
     */
    log?:
      | 'trace'
      | 'debug'
      | 'info'
      | 'warn'
      | 'error'
      | (string & {})
      | boolean
      | undefined
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
