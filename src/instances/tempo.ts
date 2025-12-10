import * as os from 'node:os'
import * as path from 'node:path'
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers'
import * as Instance from '../Instance.js'
import { execa } from '../processes/execa.js'

export function command(parameters: tempo.Parameters): string[] {
  const { faucet, port } = parameters
  const dataDir = path.join(os.tmpdir(), '.prool', `tempo.${port}`)
  return [
    'node',
    `--authrpc.port=${port! + 30}`,
    `--datadir=${dataDir}`,
    '--dev',
    `--dev.block-time=${parameters?.blockTime ?? '50ms'}`,
    '--engine.disable-precompile-cache',
    '--engine.legacy-state-root',
    '--faucet.address',
    ...(faucet?.addresses ?? [
      '0x20c0000000000000000000000000000000000000',
      '0x20c0000000000000000000000000000000000001',
      '0x20c0000000000000000000000000000000000002',
      '0x20c0000000000000000000000000000000000003',
    ]),
    `--faucet.amount=${faucet?.amount ?? '1000000000000'}`,
    '--faucet.enabled',
    `--faucet.private-key=${faucet?.privateKey ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'}`,
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
  ]
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
  const { binary = 'tempo', log: log_, ...args } = parameters || {}

  const log = (() => {
    try {
      return JSON.parse(log_ as string)
    } catch {
      return log_
    }
  })()
  const RUST_LOG = log && typeof log !== 'boolean' ? log : ''

  const name = 'tempo'
  const process = execa({ name })

  return {
    _internal: {
      args,
      get process() {
        return process._internal.process
      },
    },
    host: args.host ?? 'localhost',
    name,
    port: args.port ?? 8545,
    async start({ port = args.port }, options) {
      return await process.start(
        ($) =>
          $({
            env: {
              RUST_LOG,
            },
          })`${[binary, ...command({ ...parameters, port })]}`,
        {
          ...options,
          // Resolve when the process is listening via "RPC HTTP server started" message.
          resolver({ process, reject, resolve }) {
            process.stdout.on('data', (data) => {
              const message = data.toString()
              if (log) console.log(message)
              if (message.includes('RPC HTTP server started')) resolve()
              if (message.includes('shutting down')) reject('shutting down')
            })
            process.stderr.on('data', (data) => {
              const message = data.toString()
              if (log) console.error(message)
            })
          },
        },
      )
    },
    async stop() {
      await process.stop()
    },
  }
})

export declare namespace tempo {
  export type Parameters = {
    /**
     * Path or alias to the Tempo binary.
     */
    binary?: string | undefined
    /**
     * Interval between blocks.
     */
    blockTime?: string | undefined
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

/**
 * Defines a Tempo instance.
 *
 * @example
 * ```ts
 * const instance = Instance.tempoDocker({ port: 8545 })
 * await instance.start()
 * // ...
 * await instance.stop()
 * ```
 */
export const tempoDocker = Instance.define(
  (parameters?: tempoDocker.Parameters) => {
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

        const c = new GenericContainer(image)
          .withPlatform('linux/x86_64')
          .withNetworkMode('host')
          .withExtraHosts([
            { host: 'host.docker.internal', ipAddress: 'host-gateway' },
            { host: 'localhost', ipAddress: 'host-gateway' },
          ])
          .withName(containerName)
          .withEnvironment({ RUST_LOG })
          .withCommand(command({ ...parameters, port }))
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
          .withStartupTimeout(10_000)

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
  },
)

export declare namespace tempoDocker {
  export type Parameters = Omit<tempo.Parameters, 'binary'> & {
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
