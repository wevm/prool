import * as os from 'node:os'
import * as path from 'node:path'
import * as Instance from '../Instance.js'
import { deepAssign, toArgs } from '../internal/utils.js'
import { execa } from '../processes/execa.js'

// `tempo-zone dev` derives the WS RPC (port + 1) and P2P (port + 2) ports from
// `http.port`. Each instance occupies the compact block [port, port + 4].
export function command(parameters: tempoZone.Parameters): string[] {
  const { nodeArgs, port, ...rest } = parameters

  const datadir = path.join(os.tmpdir(), '.prool', `tempo-zone.${port}`)
  const defaultParameters = {
    datadir,
    http: {
      addr: '0.0.0.0',
      port: port!,
    },
    l1: {
      rpcUrl: 'ws://localhost:8546',
    },
    privateRpc: {
      port: port! + 3,
    },
  }

  const args = deepAssign(defaultParameters, rest)

  return [
    'dev',
    ...toArgs(args, {
      arraySeparator: null,
    }),
    // Forwarded to `tempo-zone node`; keeps concurrent instances from colliding.
    '--',
    '--authrpc.port',
    String(port! + 4),
    '--ipcdisable',
    ...((nodeArgs as string[] | undefined) ?? []),
  ]
}

/**
 * Defines a Tempo Zone instance.
 *
 * Provisions a fresh zone against a Tempo dev L1 (`tempo-zone dev`) and runs
 * the zone node. Requires a reachable Tempo dev L1 websocket RPC (`l1.rpcUrl`).
 *
 * @example
 * ```ts
 * const instance = Instance.tempoZone({
 *   l1: { rpcUrl: 'ws://localhost:8546' },
 *   port: 9545,
 * })
 * await instance.start()
 * // ...
 * await instance.stop()
 * ```
 */
export const tempoZone = Instance.define(
  (parameters?: tempoZone.Parameters) => {
    const { binary = 'tempo-zone', log: log_, ...args } = parameters || {}

    const log = (() => {
      try {
        return JSON.parse(log_ as string)
      } catch {
        return log_
      }
    })()
    const RUST_LOG = log && typeof log !== 'boolean' ? log : ''

    const name = 'tempo-zone'
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
      port: args.port ?? 9545,
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
            // Resolve when the zone RPC server is listening (fires after provisioning).
            resolver({ process, reject, resolve }) {
              let stderr = ''
              process.stdout.on('data', (data) => {
                const message = data.toString()
                if (log) console.log(message)
                if (message.includes('RPC HTTP server started')) resolve()
                if (message.includes('shutting down')) reject('shutting down')
              })
              process.stderr.on('data', (data) => {
                const message = data.toString()
                if (log) console.error(message)
                stderr += message
              })
              // Provisioning failures (e.g. unreachable L1) exit non-zero before the RPC starts.
              process.once('exit', (code) => {
                if (code) reject(stderr || `exited with code ${code}`)
              })
            },
          },
        )
      },
      async stop() {
        await process.stop()
      },
    }
  },
)

export declare namespace tempoZone {
  export type Parameters = {
    /**
     * Path or alias to the Tempo Zone binary.
     */
    binary?: string | undefined
    /**
     * Directory for genesis.json, zone.json, node data, and logs. Wiped on start.
     */
    datadir?: string | undefined
    /**
     * Dev provisioning options.
     */
    dev?:
      | {
          /**
           * Dev private key (hex): L1 fee payer, factory deployer, portal admin,
           * and zone sequencer.
           */
          key?: string | undefined
          /**
           * Initial TIP-20 token enabled on the portal.
           * @default pathUSD (0x20c0000000000000000000000000000000000000)
           */
          token?: string | undefined
        }
      | undefined
    /**
     * Host the server will listen on.
     */
    host?: string | undefined
    /**
     * Tempo L1 options.
     */
    l1?:
      | {
          /**
           * Existing ZoneFactory address on the L1. Deploys the bundled factory
           * when omitted.
           */
          factoryAddress?: string | undefined
          /**
           * Tempo L1 WebSocket RPC URL.
           * @default "ws://localhost:8546"
           */
          rpcUrl?: string | undefined
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
     * Extra arguments forwarded to `tempo-zone node`.
     */
    nodeArgs?: string[] | undefined
    /**
     * Port the server will listen on.
     */
    port?: number | undefined
    /**
     * Private RPC options.
     */
    privateRpc?:
      | {
          /**
           * Zone private RPC port.
           * @default `port + 3`
           */
          port?: number | undefined
        }
      | undefined
  } & Record<string, unknown>
}
