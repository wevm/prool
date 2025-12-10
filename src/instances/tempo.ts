import * as os from 'node:os'
import * as path from 'node:path'
import * as Instance from '../Instance.js'
import { execa } from '../processes/execa.js'

export type TempoParameters = {
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
export const tempo = Instance.define((parameters?: TempoParameters) => {
  const { binary = 'tempo', log: log_, ...args } = parameters || {}

  const log = (() => {
    try {
      return JSON.parse(log_ as string)
    } catch {
      return log_
    }
  })()

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
      const rustLog = log && typeof log !== 'boolean' ? log : ''
      const dataDir = path.join(os.tmpdir(), '.prool', `tempo.${port}`)

      return await process.start(
        ($) =>
          $({
            env: {
              RUST_LOG: rustLog,
            },
          })`${[
            binary,
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
          ]}`,
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
