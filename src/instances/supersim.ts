import { defineInstance } from '../instance.js'
import { execa } from '../processes/execa.js'
import { toArgs } from '../utils.js'

export type SupersimParameters = {
  /** The host the server will listen on. */
  host?: string

  /** Listening port for the L1 instance. `0` binds to any available port */
  l1Port?: number

  /** Starting port to increment from for L2 chains. `0` binds each chain to any available port */
  l2StartingPort?: number

  /** Locally fork a network in the superchain registry */
  fork?: {
    /** L1 height to fork the superchain (bounds L2 time). `0` for latest */
    l1ForkHeight?: number

    /** chains to fork in the superchain, example mainnet options: [base, lyra, metal, mode, op, orderly, race, tbn, zora] */
    chains: string[]

    /** superchain network. example options: mainnet, sepolia, sepolia-dev-0 */
    network?: string
  }

  interop?: {
    /** Automatically relay messages sent to the L2ToL2CrossDomainMessenger using account 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 */
    autorelay?: boolean
  }
}

const DEFAULT_HOST = 'localhost'
const DEFAULT_PORT = 8545

/**
 * Defines an Supersim instance.
 *
 * @example
 * ```ts
 * const instance = supersim()
 * await instance.start()
 * // ...
 * await instance.stop()
 * ```
 */
export const supersim = defineInstance((parameters?: SupersimParameters) => {
  const binary = 'supersim'

  const name = 'supersim'
  const process = execa({ name })

  const supersimArgs = {
    l1Port: parameters?.l1Port,
    l2StartingPort: parameters?.l2StartingPort,
    interop: parameters?.interop ? { ...parameters.interop } : undefined,
    ...parameters?.fork,
  }

  const args = toArgs({
    // ports
    'l1.port': parameters?.l1Port,
    'l2.starting.port': parameters?.l2StartingPort,

    // interop
    'interop.autorelay': parameters?.interop?.autorelay,

    // fork
    'l1.fork.height': parameters?.fork?.l1ForkHeight,
    chains: parameters?.fork?.chains,
    network: parameters?.fork?.network,
  })

  if (parameters?.fork) {
    args.unshift('fork')
  }

  return {
    _internal: {
      parameters,
      get process() {
        return process._internal.process
      },
    },
    host: parameters?.host ?? DEFAULT_HOST,
    name,
    port: supersimArgs.l1Port ?? DEFAULT_PORT,
    async start(_, options) {
      return await process.start(($) => $(binary, args), {
        ...options,
        resolver({ process, reject, resolve }) {
          process.stdout.on('data', (data) => {
            const message = data.toString()
            if (message.includes('supersim is ready')) resolve()
          })
          process.stderr.on('data', (data) => reject(data.toString()))
        },
      })
    },
    async stop() {
      await process.stop()
    },
  }
})
