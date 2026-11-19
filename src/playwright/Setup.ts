/** A service that the setup starts and stops, such as an `Instance` or a `Server`. */
export type Startable = {
  start(): Promise<unknown>
  stop(): Promise<unknown>
}

/**
 * A service, or a factory that creates it once the services before it have started, such as one
 * that reads an earlier server's `url()`.
 */
export type Definition = Startable | (() => Startable)

type Resolve<definition> = definition extends () => infer result
  ? result
  : definition

/** Started services keyed by name. */
export type Started<definitions extends Record<string, Definition>> = {
  [name in keyof definitions]: Resolve<definitions[name]>
}

/**
 * Defines a Playwright global setup that starts services in order, stops the started ones in
 * reverse order when a later one fails, and returns the teardown, which stops every service in
 * reverse order. `env` values are set on `process.env`, which Playwright's workers inherit.
 *
 * @example
 * ```ts
 * // e2e/setup.ts
 * import { Server } from 'prool'
 * import { Setup } from 'prool/playwright'
 * import * as TestContainers from 'prool/testcontainers'
 *
 * const chain = Server.create({
 *   instance: TestContainers.Instance.tempo({ port: 9545 }),
 *   port: 9545,
 *   ready: { chainId: 1337 },
 *   url: process.env.TEMPO_RPC_URL,
 * })
 *
 * export default Setup.define({
 *   instances: {
 *     chain,
 *     // A factory runs after `chain` starts, so `chain.url()` resolves.
 *     id: () =>
 *       TestContainers.Instance.tempoId({
 *         rpcUrls: { local: { chainId: 1337, url: chain.url(1) } },
 *         url: process.env.TEMPO_ID_URL,
 *       }),
 *   },
 *   env: ({ chain, id }) => ({ TEMPO_RPC_URL: chain.url(1), TEMPO_ID_URL: id.url }),
 * })
 * ```
 */
export function define<const definitions extends Record<string, Definition>>(
  parameters: define.Parameters<definitions>,
): define.ReturnType {
  return async () => {
    const started: [string, Startable][] = []

    async function stop() {
      const errors: unknown[] = []
      for (const [, service] of started.toReversed())
        await service.stop().catch((error: unknown) => errors.push(error))
      started.length = 0
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1)
        throw new AggregateError(errors, 'Failed to stop Playwright services.')
    }

    try {
      for (const [name, definition] of Object.entries(parameters.instances)) {
        const service =
          typeof definition === 'function' ? definition() : definition
        await service.start()
        started.push([name, service])
      }
      const env = parameters.env?.(
        Object.fromEntries(started) as Started<definitions>,
      )
      for (const [key, value] of Object.entries(env ?? {}))
        if (value !== undefined) process.env[key] = value
      return stop
    } catch (error) {
      try {
        await stop()
      } catch (stopError) {
        throw new AggregateError(
          [error, stopError],
          'Failed to set up or stop Playwright services.',
        )
      }
      throw error
    }
  }
}

export declare namespace define {
  export type Parameters<definitions extends Record<string, Definition>> = {
    /** Services or factories in start order, keyed by name. */
    instances: definitions
    /** Environment variables to set once every service has started. */
    env?:
      | ((
          started: Started<NoInfer<definitions>>,
        ) => Record<string, string | undefined>)
      | undefined
  }

  /** Playwright global setup function. Resolves to the teardown. */
  export type ReturnType = (config?: unknown) => Promise<() => Promise<void>>
}
