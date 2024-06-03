import { type ResultPromise, execa } from 'execa'
import { defineInstance } from '../instance.js'
import { stripColors } from '../utils.js'
import { toArgs } from '../utils.js'

export type AnvilParameters = {
  /**
   * Number of dev accounts to generate and configure.
   *
   * @defaultValue 10
   */
  accounts?: number | undefined
  /**
   * Set the Access-Control-Allow-Origin response header (CORS).
   *
   * @defaultValue *
   */
  allowOrigin?: string | undefined
  /**
   * Enable autoImpersonate on startup
   */
  autoImpersonate?: boolean | undefined
  /**
   * The balance of every dev account in Ether.
   *
   * @defaultValue 10000
   */
  balance?: number | bigint | undefined
  /**
   * The base fee in a block.
   */
  blockBaseFeePerGas?: number | bigint | undefined
  /**
   * Block time in seconds for interval mining.
   */
  blockTime?: number | undefined
  /**
   * Path or alias to the Anvil binary.
   */
  binary?: string | undefined
  /**
   * The chain id.
   */
  chainId?: number | undefined
  /**
   * EIP-170: Contract code size limit in bytes. Useful to increase this because of tests.
   *
   * @defaultValue 0x6000 (~25kb)
   */
  codeSizeLimit?: number | undefined
  /**
   * Sets the number of assumed available compute units per second for this fork provider.
   *
   * @defaultValue 350
   * @see https://github.com/alchemyplatform/alchemy-docs/blob/master/documentation/compute-units.md#rate-limits-cups
   */
  computeUnitsPerSecond?: number | undefined
  /**
   * Writes output of `anvil` as json to user-specified file.
   */
  configOut?: string | undefined
  /**
   * Sets the derivation path of the child key to be derived.
   *
   * @defaultValue m/44'/60'/0'/0/
   */
  derivationPath?: string | undefined
  /**
   * Disable the `call.gas_limit <= block.gas_limit` constraint.
   */
  disableBlockGasLimit?: boolean | undefined
  /**
   * Dump the state of chain on exit to the given file. If the value is a directory, the state will be
   * written to `<VALUE>/state.json`.
   */
  dumpState?: string | undefined
  /**
   * Fetch state over a remote endpoint instead of starting from an empty state.
   *
   * If you want to fetch state from a specific block number, add a block number like `http://localhost:8545@1400000`
   * or use the `forkBlockNumber` option.
   */
  forkUrl?: string | undefined
  /**
   * Fetch state from a specific block number over a remote endpoint.
   *
   * Requires `forkUrl` to be set.
   */
  forkBlockNumber?: number | bigint | undefined
  /**
   * Specify chain id to skip fetching it from remote endpoint. This enables offline-start mode.
   *
   * You still must pass both `forkUrl` and `forkBlockNumber`, and already have your required state cached
   * on disk, anything missing locally would be fetched from the remote.
   */
  forkChainId?: number | undefined
  /**
   * Specify headers to send along with any request to the remote JSON-RPC server in forking mode.
   *
   * e.g. "User-Agent: test-agent"
   *
   * Requires `forkUrl` to be set.
   */
  forkHeader?: Record<string, string> | undefined
  /**
   * Initial retry backoff on encountering errors.
   */
  forkRetryBackoff?: number | undefined
  /**
   * The block gas limit.
   */
  gasLimit?: number | bigint | undefined
  /**
   * The gas price.
   */
  gasPrice?: number | bigint | undefined
  /**
   * The EVM hardfork to use.
   */
  hardfork?:
    | 'Frontier'
    | 'Homestead'
    | 'Dao'
    | 'Tangerine'
    | 'SpuriousDragon'
    | 'Byzantium'
    | 'Constantinople'
    | 'Petersburg'
    | 'Istanbul'
    | 'Muirglacier'
    | 'Berlin'
    | 'London'
    | 'ArrowGlacier'
    | 'GrayGlacier'
    | 'Paris'
    | 'Shanghai'
    | 'Cancun'
    | 'Latest'
    | undefined
  /**
   * The host the server will listen on.
   */
  host?: string | undefined
  /**
   * Initialize the genesis block with the given `genesis.json` file.
   */
  init?: string | undefined
  /**
   * Launch an ipc server at the given path or default path = `/tmp/anvil.ipc`.
   */
  ipc?: string | undefined
  /**
   * Initialize the chain from a previously saved state snapshot.
   */
  loadState?: string | undefined
  /**
   * BIP39 mnemonic phrase used for generating accounts.
   */
  mnemonic?: string | undefined
  /**
   * Automatically generates a BIP39 mnemonic phrase, and derives accounts from it.
   */
  mnemonicRandom?: boolean | undefined
  /**
   * Disable CORS.
   */
  noCors?: boolean | undefined
  /**
   * Disable auto and interval mining, and mine on demand instead.
   */
  noMining?: boolean | undefined
  /**
   * Disables rate limiting for this node's provider.
   *
   * @defaultValue false
   * @see https://github.com/alchemyplatform/alchemy-docs/blob/master/documentation/compute-units.md#rate-limits-cups
   */
  noRateLimit?: boolean | undefined
  /**
   * Explicitly disables the use of RPC caching.
   *
   * All storage slots are read entirely from the endpoint.
   */
  noStorageCaching?: boolean | undefined
  /**
   * How transactions are sorted in the mempool.
   *
   * @defaultValue fees
   */
  order?: string | undefined
  /**
   * Run an Optimism chain.
   */
  optimism?: boolean | undefined
  /**
   * Port number to listen on.
   *
   * @defaultValue 8545
   */
  port?: number | undefined
  /**
   * Don't keep full chain history. If a number argument is specified, at most this number of states is kept in memory.
   */
  pruneHistory?: number | undefined | boolean
  /**
   * Number of retry requests for spurious networks (timed out requests).
   *
   * @defaultValue 5
   */
  retries?: number | undefined
  /**
   * Don't print anything on startup and don't print logs.
   */
  silent?: boolean | undefined
  /**
   * Slots in an epoch.
   */
  slotsInAnEpoch?: number | undefined
  /**
   * Enable steps tracing used for debug calls returning geth-style traces.
   */
  stepsTracing?: boolean | undefined
  /**
   * Interval in seconds at which the status is to be dumped to disk.
   */
  stateInterval?: number | undefined
  /**
   * This is an alias for both `loadState` and `dumpState`. It initializes the chain with the state stored at the
   * file, if it exists, and dumps the chain's state on exit
   */
  state?: string | undefined
  /**
   * Timeout in ms for requests sent to remote JSON-RPC server in forking mode.
   *
   * @defaultValue 45000
   */
  timeout?: number | undefined
  /**
   * The timestamp of the genesis block.
   */
  timestamp?: number | bigint | undefined
  /**
   * Number of blocks with transactions to keep in memory.
   */
  transactionBlockKeeper?: number | undefined
}

/**
 * Defines an Anvil instance.
 *
 * @example
 * ```ts
 * const instance = anvil({ forkRpcUrl: 'https://cloudflare-eth.com', port: 8546 })
 * await instance.start()
 * // ...
 * await instance.stop()
 * ```
 */
export const anvil = defineInstance((parameters?: AnvilParameters) => {
  const { binary = 'anvil', ...args } = parameters || {}

  let process: ResultPromise<{ cleanup: true; reject: false }>

  async function stop() {
    const killed = process.kill()
    if (!killed) throw new Error('Failed to stop anvil')
    return new Promise((resolve) => process.on('close', resolve))
  }

  return {
    _internal: {
      args,
      get process() {
        return process
      },
    },
    host: args.host ?? 'localhost',
    name: 'anvil',
    port: args.port ?? 8545,
    async start({ emitter, port = args.port, status }) {
      const { promise, resolve, reject } = Promise.withResolvers<void>()

      process = execa(binary, toArgs({ ...args, port }), {
        cleanup: true,
        reject: false,
      })

      process.stdout.on('data', (data) => {
        const message = stripColors(data.toString())
        emitter.emit('message', message)
        emitter.emit('stdout', message)
        if (message.includes('Listening on')) {
          emitter.emit('listening')
          resolve()
        }
      })
      process.stderr.on('data', async (data) => {
        const message = stripColors(data.toString())
        emitter.emit('message', message)
        emitter.emit('stderr', message)
        await stop()
        reject(new Error(`Failed to start anvil: ${data.toString()}`))
      })
      process.on('close', () => process.removeAllListeners())
      process.on('exit', (code, signal) => {
        emitter.emit('exit', code, signal)

        if (!code) {
          process.removeAllListeners()
          if (status === 'starting') reject(new Error('Anvil exited.'))
        }
      })

      return promise
    },
    async stop() {
      process.removeAllListeners()
      await stop()
    },
  }
})
