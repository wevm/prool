import { realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers'
import * as Instance from '../../Instance.js'

/**
 * Runs an L1-free Base snapshot devnet in one Docker container.
 * Defaults to fresh container-owned copies of the bundled synthetic snapshot.
 * Optional mainnet snapshot directories are caller-owned and retained on stop.
 */
export const base = Instance.define<
  undefined,
  base.Parameters | undefined,
  {
    default: Instance.Endpoint<'http'>
    builder: Instance.Endpoint<'http'>
    client: Instance.Endpoint<'http'>
  }
>((parameters) => {
  const {
    image = 'prool-base-localnet:728fcd5fc5837d01a78a2e9f34728b0d8fdb1867',
    platform = 'linux/amd64',
    snapshot,
    blockTime = '2s',
    prefund,
    expectedHead,
    host = 'localhost',
    log,
    startupTimeout = 300_000,
  } = parameters ?? {}
  if (snapshot && (!snapshot.builder || !snapshot.client))
    throw new Error('Base requires snapshot.builder and snapshot.client paths')
  if (blockTime !== '2s' && blockTime !== '200ms')
    throw new Error('Base blockTime must be 2s or 200ms')
  if (!Number.isSafeInteger(startupTimeout) || startupTimeout <= 0)
    throw new Error('startupTimeout must be a positive integer in milliseconds')
  if (prefund && !/^0x[0-9a-fA-F]{40}$/.test(prefund.address))
    throw new Error('prefund.address must be a 20-byte hex address')
  if (
    prefund?.amount !== undefined &&
    (typeof prefund.amount !== 'bigint' ||
      prefund.amount < 0n ||
      prefund.amount >= 1n << 128n)
  )
    throw new Error('prefund.amount must be an unsigned 128-bit bigint in wei')
  if (
    expectedHead &&
    (!Number.isSafeInteger(expectedHead.number) ||
      expectedHead.number < 0 ||
      !Number.isSafeInteger(expectedHead.timestamp) ||
      expectedHead.timestamp < 0 ||
      !/^0x[0-9a-fA-F]{64}$/.test(expectedHead.hash))
  )
    throw new Error('expectedHead requires a valid number, hash, and timestamp')

  let container: StartedTestContainer | undefined
  async function teardown() {
    if (!container) return
    await container.stop({ timeout: 30_000 })
    container = undefined
  }

  return {
    name: 'base',
    host,
    port: 7545,
    endpoints: {
      default: { host, port: 7545, protocol: 'http' },
      builder: { host, port: 7545, protocol: 'http' },
      client: { host, port: 8545, protocol: 'http' },
    },
    async start(_, { emitter, setEndpoint }) {
      await teardown()
      // Check before mounting so Docker cannot silently create empty directories.
      // These are local, caller-owned paths, also accessible to the Docker daemon.
      const directories = await Promise.all(
        (snapshot ? [snapshot.builder, snapshot.client] : []).map(
          async (path) => {
            try {
              const directory = await realpath(path)
              const database = await stat(join(directory, 'db/mdbx.dat'))
              if (!database.isFile())
                throw new Error('db/mdbx.dat is not a file')
              return { directory, database }
            } catch (cause) {
              throw new Error(
                `Base snapshot at ${path} must contain db/mdbx.dat`,
                {
                  cause,
                },
              )
            }
          },
        ),
      )
      const [builder, client] = directories
      if (
        builder &&
        client &&
        (builder.directory === client.directory ||
          (builder.database.dev === client.database.dev &&
            builder.database.ino === client.database.ino))
      )
        throw new Error(
          'Base requires separate writable builder and client snapshots',
        )

      const command = [
        'snapshot',
        '--stable-ports',
        '--builder-datadir',
        '/data/builder',
        '--client-datadir',
        '/data/client',
        '--runtime-file',
        '/run/base/runtime.json',
        '--block-interval',
        blockTime,
      ]
      if (prefund) {
        command.push('--prefund-address', prefund.address)
        if (prefund.amount !== undefined)
          command.push('--prefund-amount', String(prefund.amount))
      }
      if (expectedHead)
        command.push(
          '--expected-head-number',
          String(expectedHead.number),
          '--expected-head-hash',
          expectedHead.hash,
          '--expected-head-timestamp',
          String(expectedHead.timestamp),
        )

      container = await new GenericContainer(image)
        .withPlatform(platform)
        .withExposedPorts(7545, 8545)
        .withBindMounts(
          builder && client
            ? [
                {
                  source: builder.directory,
                  target: '/data/builder',
                  mode: 'rw',
                },
                {
                  source: client.directory,
                  target: '/data/client',
                  mode: 'rw',
                },
              ]
            : [],
        )
        .withEnvironment({
          RUST_LOG: typeof log === 'string' ? log : 'info',
          PROOL_BASE_FIXTURE: snapshot ? '0' : '1',
        })
        .withCommand(command)
        .withWaitStrategy(Wait.forLogMessage('snapshot devnet ready'))
        .withStartupTimeout(startupTimeout)
        .withLogConsumer((stream) => {
          stream.on('data', (data) => {
            const message = data.toString()
            emitter.emit('message', message)
            emitter.emit('stdout', message)
            if (log) console.log(message)
          })
          stream.on('error', (error) => {
            emitter.emit('message', error.message)
            emitter.emit('stderr', error.message)
            if (log) console.error(error.message)
          })
        })
        .start()
      try {
        const builderEndpoint = {
          host: container.getHost(),
          port: container.getMappedPort(7545),
          protocol: 'http' as const,
        }
        const clientEndpoint = {
          host: container.getHost(),
          port: container.getMappedPort(8545),
          protocol: 'http' as const,
        }
        // Verify the published ports, not just the in-container readiness log.
        await Promise.all(
          [builderEndpoint, clientEndpoint].map(async (endpoint) => {
            const host =
              endpoint.host.includes(':') && !endpoint.host.startsWith('[')
                ? `[${endpoint.host}]`
                : endpoint.host
            const response = await fetch(`http://${host}:${endpoint.port}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_chainId',
                params: [],
              }),
              signal: AbortSignal.timeout(10_000),
            })
            const body = (await response.json()) as { result?: string }
            if (!response.ok || body.result !== '0x2105')
              throw new Error('Base snapshot RPC must report chain ID 8453')
          }),
        )
        setEndpoint?.(builderEndpoint)
        setEndpoint?.('builder', builderEndpoint)
        setEndpoint?.('client', clientEndpoint)
      } catch (error) {
        try {
          await teardown()
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            'Base startup and cleanup failed',
          )
        }
        throw error
      }
    },
    stop: teardown,
  }
})

export declare namespace base {
  export type Parameters = {
    /** Optional mainnet snapshot clones. Defaults to fresh copies of the bundled synthetic snapshot. */
    snapshot?:
      | {
          /** Local builder datadir containing db/mdbx.dat. Mutated during the run, retained on stop. */
          builder: string
          /** Separate local client datadir containing db/mdbx.dat. Mutated during the run, retained on stop. */
          client: string
        }
      | undefined
    /** Docker image containing base-devnet with public HTTP bindings and SIGINT shutdown. */
    image?: string | undefined
    /** Docker platform. Defaults to linux/amd64. Other architectures require Docker emulation or a matching custom image. */
    platform?: string | undefined
    /** Block interval. Defaults to 2s. */
    blockTime?: '2s' | '200ms' | undefined
    /** Mint ETH to a throwaway account in the first local descendant block. */
    prefund?:
      | {
          /** Test account address. Do not use an account holding real assets. */
          address: `0x${string}`
          /** Amount in wei, up to 2^128 - 1. Defaults to 1,000 ETH. */
          amount?: bigint | undefined
        }
      | undefined
    /** Optional identity check for the initial snapshot head. */
    expectedHead?:
      | {
          /** Expected snapshot block number. */
          number: number
          /** Expected snapshot block hash. */
          hash: `0x${string}`
          /** Expected snapshot Unix timestamp in seconds. */
          timestamp: number
        }
      | undefined
    /** Initial endpoint host. Replaced by Docker's reachable host after startup. */
    host?: string | undefined
    /** Print logs. A string also sets the launcher's RUST_LOG filter. */
    log?: boolean | string | undefined
    /** Container readiness timeout in milliseconds. Defaults to 300,000. */
    startupTimeout?: number | undefined
  }
}
