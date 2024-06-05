import { platform } from 'node:os'
import { defineInstance } from '../instance.js'
import { execa } from '../processes/execa.js'

export type StackupParameters = {
  /**
   * The name of the native tracer to use during validation. This will be "bundlerCollectorTracer" if using builds from ERC-4337 execution client repo.
   * Defaults to address of `privateKey`.
   */
  beneficiary?: string | undefined
  /**
   * Directory to store the embedded database.
   * @default /tmp/stackup_bundler
   */
  dataDirectory?: string | undefined
  /**
   * RPC url to the execution client.
   */
  ethClientUrl: string
  /**
   * A boolean value for bundlers on an Arbitrum stack network to properly account for the L1 callData cost.
   * @default false
   */
  isArbStackNetwork?: boolean | undefined
  /**
   * A boolean value for bundlers on an OP stack network to properly account for the L1 callData cost.
   * @default false
   */
  isOpStackNetwork?: boolean | undefined
  /**
   * A boolean value for bundlers on a network that supports RIP-7212 precompile for secp256r1 signature verification.
   * @default false
   */
  isRip7212Supported?: boolean | undefined
  /**
   * The maximum gas limit that can be submitted per UserOperation batch.
   * @default 18_000_000
   */
  maxBatchGasLimit?: number | undefined
  /**
   * The maximum duration that a userOp can stay in the mempool before getting dropped.
   * @default 180
   */
  maxOpTtlSeconds?: number | undefined
  /**
   * The maximum verificationGasLimit on a received UserOperation.
   * @default 6_000_000
   */
  maxVerificationGas?: number | undefined
  /**
   * The maximum block range when looking up a User Operation with eth_getUserOperationReceipt or eth_getUserOperationByHash.
   *
   * Higher limits allow for fetching older User Operations but will result in higher request latency due to additional compute on the underlying node.
   *
   * @default 2_000
   */
  opLookupLimit?: number | undefined
  /**
   * Port to start the instance on.
   */
  port?: number | undefined
  /**
   * The private key for the EOA used to relay User Operation bundles to the EntryPoint.
   */
  privateKey: string
  /**
   * EntryPoint addresses to support. The first address is the preferred EntryPoint.
   */
  supportedEntryPoints?: string[]
}

/**
 * Defines an Anvil instance.
 *
 * @example
 * ```ts
 * const instance = stackup({
 *  ethClientUrl: 'http://localhost:8545',
 *  port: 4337,
 *  privateKey: '0x...'
 * })
 * await instance.start()
 * // ...
 * await instance.stop()
 * ```
 */
export const stackup = defineInstance((parameters?: StackupParameters) => {
  const args = (parameters || {}) as StackupParameters

  const host = 'localhost'
  const name = 'stackup'
  const process = execa({ name })

  return {
    _internal: {
      args,
      get process() {
        return process._internal.process
      },
    },
    host,
    name,
    port: args.port ?? 4337,
    async start({ port = args.port }, options) {
      const args_ = [
        ...(platform() === 'linux' ? ['--net', 'host'] : []),
        '--add-host',
        'host.docker.internal:host-gateway',
        '--add-host',
        'localhost:host-gateway',
        '-p',
        `${port}:${port}`,
        '-e',
        `ERC4337_BUNDLER_PORT=${port}`,
        ...Object.entries(args).flatMap(([key, value]) => {
          if (key === 'port') return []
          if (value === undefined) return []

          if (key === 'ethClientUrl')
            value = (value as string).replaceAll(
              /127\.0\.0\.1|0\.0\.0\.0/g,
              'host.docker.internal',
            )
          if (key === 'privateKey') value = (value as string).replace('0x', '')

          return [
            '-e',
            `ERC4337_BUNDLER_${key
              .replace(/([a-z])([A-Z])/g, '$1_$2')
              .toUpperCase()}=${value}`,
          ]
        }),
        'stackupwallet/stackup-bundler:latest',
        '/app/stackup-bundler',
        'start',
        '--mode',
        'private',
      ]
      return await process.start(($) => $`docker run ${args_}`, {
        ...options,
        resolver({ process, resolve, reject }) {
          process.stderr.on('data', async (data) => {
            const message = data.toString()
            // For some reason, `stackup-bundler` logs to stderr. So we have to try
            // and dissect what is an error, and what is not. 😅
            if (message.includes('Set nextTxnTs to'))
              setTimeout(() => resolve(), 100)
            else if (
              message
                .toLowerCase()
                .match(/panic|error|connection refused|address already in use/)
            )
              reject(data)
          })
        },
      })
    },
    async stop() {
      await process.stop()
    },
  }
})
