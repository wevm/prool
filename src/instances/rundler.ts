import getPort from 'get-port'

import { defineInstance } from '../instance.js'
import { execa } from '../processes/execa.js'
import { toArgs } from '../utils.js'

export type RundlerParameters = {
  /**
   * The path to the rundler binary
   *
   * @default rundler
   */
  binary?: string

  /**
   * The version of the entrypoint to use
   *
   * @default 0.6.0
   */
  entryPointVersion?: '0.6.0' | '0.7.0'

  /**
   * Network to look up a hardcoded chain spec.
   * @default dev
   */
  network?: string

  /**
   * Path to a chain spec TOML file.
   */
  chainSpec?: string

  /**
   * EVM Node HTTP URL to use.
   *
   * @default http://localhost:8545
   */
  nodeHttp?: string

  /**
   * Maximum verification gas.
   * @default 5000000
   */
  maxVerificationGas?: number

  /**
   * Maximum bundle gas.
   * @default 25000000
   */
  maxBundleGas?: number

  /**
   * Minimum stake value.
   * @default 1000000000000000000
   */
  minStakeValue?: number

  /**
   * Minimum unstake delay.
   * @default 84600
   */
  minUnstakeDelay?: number

  /**
   * Number of blocks to search when calling eth_getUserOperationByHash.
   * @default 100
   */
  userOperationEventBlockDistance?: number

  /**
   * Maximum gas for simulating handle operations.
   * @default 20000000
   */
  maxSimulateHandleOpsGas?: number

  /**
   * The gas fee to use during verification estimation.
   * @default 1000000000000 10K gwei
   */
  verificationEstimationGasFee?: number

  /**
   * Bundle transaction priority fee overhead over network value.
   * @default 0
   */
  bundlePriorityFeeOverheadPercent?: number

  /**
   * Priority fee mode kind.
   * Possible values are base_fee_percent and priority_fee_increase_percent.
   * @default priority_fee_increase_percent
   */
  priorityFeeModeKind?: 'base_fee_percent' | 'priority_fee_increase_percent'

  /**
   * Priority fee mode value.
   * @default 0
   */
  priorityFeeModeValue?: number

  /**
   * Percentage of the current network fees a user operation must have in order to be accepted into the mempool.
   * @default 100
   */
  baseFeeAcceptPercent?: number

  /**
   * AWS region.
   * @default us-east-1
   */
  awsRegion?: string

  /**
   * Interval at which the builder polls an RPC node for new blocks and mined transactions.
   * @default 100
   */
  ethPollIntervalMillis?: number

  /**
   * Flag for unsafe bundling mode. When set Rundler will skip checking simulation rules (and any debug_traceCall).
   *
   * @default true
   */
  unsafe?: boolean

  /**
   * Path to the mempool configuration file.
   * This path can either be a local file path or an S3 url.
   */
  mempoolConfigPath?: string

  metrics?: {
    /**
     * Port to listen on for metrics requests.
     * @default 8080
     */
    port?: number

    /**
     * Host to listen on for metrics requests.
     * @default 0.0.0.0
     */
    host?: string

    /**
     * Tags for metrics in the format key1=value1,key2=value2,...
     */
    tags?: string

    /**
     * Sample interval to use for sampling metrics.
     * @default 1000
     */
    sampleIntervalMillis?: number
  }

  logging?: {
    /**
     * Log file. If not provided, logs will be written to stdout.
     */
    file?: string

    /**
     * If set, logs will be written in JSON format.
     */
    json?: boolean
  }

  rpc?: {
    /**
     * Port to listen on for JSON-RPC requests.
     * @default 3000
     */
    port?: number

    /**
     * Host to listen on for JSON-RPC requests.
     * @default 127.0.0.1
     */
    host?: string

    /**
     * Which APIs to expose over the RPC interface.
     * @default eth,rundler
     */
    api?: string

    /**
     * Timeout for RPC requests.
     * @default 20
     */
    timeoutSeconds?: number

    /**
     * Maximum number of concurrent connections.
     * @default 100
     */
    maxConnections?: number
  }

  pool?: {
    /**
     * Maximum size in bytes for the pool.
     * @default 500000000, 0.5 GB
     */
    maxSizeInBytes?: number

    /**
     * Maximum number of user operations for an unstaked sender.
     * @default 4
     */
    sameSenderMempoolCount?: number

    /**
     * Minimum replacement fee increase percentage.
     * @default 10
     */
    minReplacementFeeIncreasePercentage?: number

    /**
     * Path to a blocklist file.
     * This path can either be a local file path or an S3 url.
     */
    blocklistPath?: string

    /**
     * Path to an allowlist file.
     * This path can either be a local file path or an S3 url.
     */
    allowlistPath?: string

    /**
     * Size of the chain history.
     */
    chainHistorySize?: number

    /**
     * Boolean field that sets whether the pool server starts with paymaster tracking enabled.
     * @default true
     */
    paymasterTrackingEnabled?: boolean

    /**
     * Length of the paymaster cache.
     * @default 10_000
     */
    paymasterCacheLength?: number

    /**
     * Boolean field that sets whether the pool server starts with reputation tracking enabled.
     * @default true
     */
    reputationTrackingEnabled?: boolean

    /**
     * The minimum number of blocks that a UO must stay in the mempool before it can be requested to be dropped by the user.
     * @default 10
     */
    dropMinNumBlocks?: number
  }

  builder?: {
    /**
     * Private key to use for signing transactions.
     * If used with awsKmsKeyIds, then explicitly pass in `null` here.
     *
     * @default 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
     */
    privateKey?: string

    /**
     * AWS KMS key IDs to use for signing transactions (comma-separated).
     * Only required if privateKey is not provided.
     */
    awsKmsKeyIds?: string

    /**
     * Redis URI to use for KMS leasing.
     * Only required when awsKmsKeyIds are provided.
     *
     * @default ""
     */
    redisUri?: string

    /**
     * Redis lock TTL in milliseconds.
     * Only required when awsKmsKeyIds are provided.
     * @default 60000
     */
    redisLockTtlMillis?: number

    /**
     * Maximum number of ops to include in one bundle.
     * @default 128
     */
    maxBundleSize?: number

    /**
     * If present, the URL of the ETH provider that will be used to send transactions.
     * Defaults to the value of nodeHttp.
     */
    submitUrl?: string

    /**
     * Choice of what sender type to use for transaction submission.
     * @default raw
     * options: raw, conditional, flashbots, polygon_bloxroute
     */
    sender?: 'raw' | 'conditional' | 'flashbots' | 'polygonBloxroute'

    /**
     * After submitting a bundle transaction, the maximum number of blocks to wait for that transaction to mine before trying to resend with higher gas fees.
     * @default 2
     */
    maxBlocksToWaitForMine?: number

    /**
     * Percentage amount to increase gas fees when retrying a transaction after it failed to mine.
     * @default 10
     */
    replacementFeePercentIncrease?: number

    /**
     * Maximum number of fee increases to attempt.
     * Seven increases of 10% is roughly 2x the initial fees.
     * @default 7
     */
    maxFeeIncreases?: number

    /**
     * Additional builders to send bundles to through the Flashbots relay RPC (comma-separated).
     * List of builders that the Flashbots RPC supports can be found here.
     * @default flashbots
     */
    flashbotsRelayBuilders?: string

    /**
     * Authorization key to use with the Flashbots relay.
     * See here for more info.
     * @default None
     */
    flashbotsRelayAuthKey?: string

    /**
     * If using the bloxroute transaction sender on Polygon, this is the auth header to supply with the requests.
     * @default None
     */
    bloxrouteAuthHeader?: string

    /**
     * If running multiple builder processes, this is the index offset to assign unique indexes to each bundle sender.
     * @default 0
     */
    indexOffset?: number
  }
}

/**
 * Defines a Rundler instance.
 *
 * @example
 * ```ts
 * const instance = rundler({
 *  nodeHttp: 'http://localhost:8545',
 * });
 *
 * await instance.start()
 * // ...
 * await instance.stop()
 * ```
 */
export const rundler = defineInstance((parameters?: RundlerParameters) => {
  const { binary = 'rundler', ...args } = (parameters ??
    {}) as RundlerParameters

  const host = '127.0.0.1'
  const name = 'rundler'
  const process = execa({ name })

  return {
    _internal: {
      args,
      get process() {
        return process._internal.process
      },
    },
    host,
    port: args.rpc?.port ?? 3000,
    name,
    async start({ port = args.rpc?.port ?? 3000 }, options) {
      const args_ = {
        ...args,
        builder: {
          ...args.builder,
          privateKey:
            args.builder?.privateKey ??
            '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        },
        entryPointVersion: undefined,
        maxVerificationGas: args.maxVerificationGas ?? 10000000,
        network: args.network ?? 'dev',
        nodeHttp: args.nodeHttp ?? 'http://localhost:8545',
        metrics: {
          ...args.metrics,
          port: await getPort(),
        },
        rpc: {
          ...args.rpc,
          port,
        },
        unsafe: args.unsafe ?? true,
        userOperationEventBlockDistance:
          args.userOperationEventBlockDistance ?? 100,
      } satisfies RundlerParameters

      const entrypointArgs = (() => {
        if (args.entryPointVersion === '0.6.0')
          return ['--disable_entry_point_v0_7']
        return ['--disable_entry_point_v0_6']
      })()

      return await process.start(
        ($) =>
          $(
            binary,
            ['node', ...toArgs(args_, { casing: 'snake' }), ...entrypointArgs],
            {
              env: {
                RUST_LOG: 'debug',
              },
            },
          ),
        {
          ...options,
          resolver({ process, reject, resolve }) {
            process.stdout.on('data', (data) => {
              const message = data.toString()
              if (message.includes('Started RPC server')) resolve()
            })
            process.stderr.on('data', (data) => {
              reject(data.toString())
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
