import { platform } from 'node:os'

import { rmSync } from 'node:fs'
import { defineInstance } from '../instance.js'
import { execa } from '../processes/execa.js'
import { toArgs } from '../utils.js'

export type SiliusParameters = {
  /**
   * The bundler beneficiary address.
   */
  beneficiary?: string | undefined
  /**
   * The bundle interval in seconds.
   * @default 10
   */
  bundleInterval?: number | undefined
  bundler?:
    | {
        /**
         * Bundler gRPC address to listen on.
         * @default '127.0.0.1'
         */
        addr?: string | undefined
        /**
         * Bundler gRPC port to listen on.
         * @default 3003
         */
        port?: number | undefined
      }
    | undefined
  /**
   * The chain id.
   * @default 1
   */
  chain?: number | undefined
  /**
   * Path to the data directory.
   */
  dataDir?: string | undefined
  discovery?:
    | {
        /**
         * The udp4 port to broadcast to peers in order to reach back for discovery.
         * @default 9000
         */
        port?: number | undefined
      }
    | undefined
  /**
   * Indicates whether the access list is enabled.
   */
  enableAccessList?: boolean | undefined
  /**
   * Indicates whether the P2P mode is enabled.
   */
  enableP2p?: boolean | undefined
  /**
   * Indicates whether the metrics are enabled.
   */
  enableMetrics?: boolean | undefined
  /**
   * The entry points for the bundler.
   */
  entryPoints?: string[] | undefined
  /**
   * RPC URL of the execution client.
   */
  ethClientAddress?: string | undefined
  /**
   * Ethereum execution client proxy HTTP RPC endpoint.
   */
  ethClientProxyAddress?: string | undefined
  http?:
    | {
        /**
         * HTTP address to listen on.
         * @default '127.0.0.1'
         */
        addr?: string | undefined
        /**
         * Configures the HTTP RPC API modules
         * @default 'eth'
         */
        api?: string[] | undefined
        /**
         * Configures the allowed CORS domains.
         * @default '*'
         */
        corsdomain?: string[] | undefined
        /**
         * HTTP port to listen on.
         * @default 3000
         */
        port?: number | undefined
      }
    | undefined
  /**
   * Maximum gas for verification.
   * @default 5000000
   */
  maxVerificationGas?: bigint | undefined
  metrics?:
    | {
        /**
         * Metrics address to listen on.
         * @default '127.0.0.1'
         */
        addr?: string | undefined
        /**
         * Metrics port to listen on.
         * @default 3030
         */
        port?: number | undefined
      }
    | undefined
  /**
   * Minimum balance for the beneficiary account.
   * @default 100000000000000000 wei
   */
  minBalance?: bigint | undefined
  /**
   * Minimum priority fee per gas.
   * @default 0
   */
  minPriorityFeePerGas?: bigint | undefined
  /**
   * Minimum stake required for entities.
   * @default 1
   */
  minStake?: number | undefined
  /**
   * Path to the mnemonic file.
   */
  mnemonicPath: string | undefined
  /**
   * The path to the file where the p2p private key is stored.
   */
  nodekey?: string | undefined
  /**
   * The path to the file where the p2p enr is stored.
   */
  nodeenr?: string | undefined
  p2p?:
    | {
        /**
         * Sets the p2p listen address
         * @default '0.0.0.0'
         */
        addr?: string | undefined
        /**
         * The ipv4 address to broadcast to peers about which address we are listening on.
         */
        baddr?: string | undefined
        /**
         * The tcp4 port to boardcast to peers in order to reach back for discovery.
         * @default 9000
         */
        bport?: number | undefined
      }
    | undefined
  /**
   * Poll interval event filters and pending transactions in milliseconds.
   * @default 500
   */
  pollInterval?: number | undefined
  /**
   * Port to start the instance on.
   */
  port?: number | undefined
  /**
   * Sets the send bundle mode.
   * @default "ethereum-client"
   */
  sendBundleMode?: string | undefined
  uopool?:
    | {
        /**
         * UoPool gRPC address to listen on.
         * @default '127.0.0.1'
         */
        addr?: string | undefined
        /**
         * UoPool gRPC port to listen on.
         * @default 3002
         */
        port?: number | undefined
      }
    | undefined
  /**
   * Sets the UoPool mode.
   */
  uopoolMode?: string | undefined
  /**
   * Sets the verbosity level.
   * @default 2
   */
  verbosity?: number | undefined
  /**
   * Addresses of whitelisted entities.
   */
  whitelist?: string[] | undefined
  ws?:
    | {
        /**
         * WS address to listen on.
         * @default '127.0.0.1'
         */
        addr?: string | undefined
        /**
         * Configures the HTTP RPC API modules
         * @default 'eth'
         */
        api?: string[] | undefined
        /**
         * Configures the allowed WS origins.
         * @default '*'
         */
        origins?: string[] | undefined
        /**
         * WS port to listen on.
         * @default 3001
         */
        port?: number | undefined
      }
    | undefined
}

/**
 * Defines an Anvil instance.
 *
 * @example
 * ```ts
 * const instance = silius({
 *  port: 4337,
 * })
 * await instance.start()
 * // ...
 * await instance.stop()
 * ```
 */
export const silius = defineInstance((parameters?: SiliusParameters) => {
  const args = (parameters || {}) as SiliusParameters
  const { dataDir = '.local', mnemonicPath, port: _, ...rest } = args

  const host = 'localhost'
  const name = 'silius'
  const process = execa({ name })
  let port = args.port ?? 4000

  return {
    _internal: {
      args,
      get process() {
        return process._internal.process
      },
    },
    host,
    name,
    port,
    async start({ port: port_ = port }, options) {
      port = port_

      const args_ = [
        ...(platform() === 'linux' ? ['--net', 'host'] : []),
        '--add-host',
        'host.docker.internal:host-gateway',
        '--add-host',
        'localhost:host-gateway',
        '-p',
        `${port}:${port}`,
        '-v',
        `${mnemonicPath}:/data/silius/mnemonic`,
        '-v',
        `./${dataDir}/${port_}/db:/data/silius/db`,
        'ghcr.io/silius-rs/silius:latest',
        'node',
        '--datadir',
        'data/silius',
        '--mnemonic-file',
        'data/silius/mnemonic',
        '--http',
        '--ws',
        ...toArgs({
          ...rest,
          beneficiary:
            rest.beneficiary ?? '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
          bundler: {
            ...rest.bundler,
            addr: rest.bundler?.addr ?? '0.0.0.0',
          },
          entryPoints: rest.entryPoints ?? [
            '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
          ],
          ethClientAddress: rest.ethClientAddress?.replaceAll(
            /127\.0\.0\.1|0\.0\.0\.0/g,
            'host.docker.internal',
          ),
          ethClientProxyAddress: rest.ethClientProxyAddress?.replaceAll(
            /127\.0\.0\.1|0\.0\.0\.0/g,
            'host.docker.internal',
          ),
          http: {
            ...rest.http,
            addr: rest.http?.addr ?? '0.0.0.0',
            api: rest.http?.api ?? ['eth', 'debug', 'web3'],
            port,
          },
          metrics: {
            ...rest.metrics,
            addr: rest.metrics?.addr ?? '0.0.0.0',
          },
          uopool: {
            ...rest.uopool,
            addr: rest.uopool?.addr ?? '0.0.0.0',
          },
          ws: {
            ...rest.ws,
            addr: rest.ws?.addr ?? '0.0.0.0',
            api: rest.ws?.api ?? ['eth', 'debug', 'web3'],
            port: rest.ws?.port ?? 4001,
          },
        } satisfies Partial<SiliusParameters>),
      ]

      return await process.start(($) => $`docker run ${args_}`, {
        ...options,
        resolver({ process, resolve, reject }) {
          process.stdout.on('data', (data) => {
            const message = data.toString()
            if (message.includes('Started bundler JSON-RPC server')) resolve()
          })
          process.stderr.on('data', (data) => {
            if (data.toString().includes('WARNING')) return
            reject(data)
          })
        },
      })
    },
    async stop() {
      try {
        rmSync(`${dataDir}/${port}`, { recursive: true, force: true })
      } catch {}
      await process.stop()
    },
  }
})
