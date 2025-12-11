import * as os from 'node:os'
import * as path from 'node:path'
import * as Instance from '../Instance.js'
import { deepAssign, toArgs } from '../internal/utils.js'
import { execa } from '../processes/execa.js'

export function command(parameters: tempo.Parameters): string[] {
  const { blockMaxTransactions, blockTime, mnemonic, port, ...rest } =
    parameters

  const datadir = path.join(os.tmpdir(), '.prool', `tempo.${port}`)
  const defaultParameters = {
    authrpc: {
      port: port! + 30,
    },
    datadir,
    dev: [
      true,
      {
        blockTime: blockTime ?? '50ms',
        ...(blockMaxTransactions ? { blockMaxTransactions } : {}),
        ...(mnemonic ? { mnemonic } : {}),
      },
    ],
    engine: {
      disablePrecompileCache: true,
      legacyStateRoot: true,
    },
    faucet: {
      address: [
        '0x20c0000000000000000000000000000000000000',
        '0x20c0000000000000000000000000000000000001',
        '0x20c0000000000000000000000000000000000002',
        '0x20c0000000000000000000000000000000000003',
      ],
      amount: '1000000000000',
      enabled: true,
      privateKey:
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    },
    http: {
      addr: '0.0.0.0',
      api: 'all',
      corsdomain: '*',
      port: port!,
    },
    port: port! + 10,
    ws: {
      port: port! + 20,
    },
  }

  return [
    'node',
    ...toArgs(deepAssign(defaultParameters, rest), {
      arraySeparator: null,
    }),
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
          })`${[binary, ...command({ ...args, port })]}`,
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
     * How many transactions to mine per block
     */
    blockMaxTransactions?: number | undefined
    /**
     * Path to a configuration file.
     */
    config?: string | undefined
    /**
     * The chain this node is running.
     * Possible values are either a built-in chain or the path to a chain specification file.
     *
     * Built-in chains:
     * - testnet
     *
     * @default "testnet"
     */
    chain?: string | undefined
    /**
     * The path to the data dir for all reth files and subdirectories.
     */
    datadir?: string | undefined
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
     * Derive dev accounts from a fixed mnemonic instead of random ones.
     * @default "test test test test test test test test test test test junk"
     */
    mnemonic?: string | undefined
    /**
     * Port the server will listen on.
     */
    port?: number | undefined
  } & Record<string, unknown>
}
