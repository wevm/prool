import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers'
import * as Instance from '../Instance.js'
import { command, type tempo as core_tempo } from '../instances/tempo.js'

export type { Instance, InstanceOptions } from '../Instance.js'

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
        .withCommand(command({ ...args, port }))
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
})

export declare namespace tempo {
  export type Parameters = Omit<core_tempo.Parameters, 'binary'> & {
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
