import getPort from 'get-port'

import type { Instance } from './instance.js'

type Instance_ = Omit<Instance, 'create'>

export type Pool<key = number> = Pick<
  Map<key, Instance_>,
  'entries' | 'keys' | 'forEach' | 'get' | 'has' | 'size' | 'values'
> & {
  _internal: {
    instance: Instance_
  }
  destroy(key: key): Promise<void>
  destroyAll(): Promise<void>
  start(key: key, options?: { port?: number }): Promise<Instance_>
  stop(key: key): Promise<void>
  stopAll(): Promise<void>
}

export type DefinePoolParameters = {
  /** Instance for the pool. */
  instance: Instance
  /** The maximum number of instances that can be started. */
  limit?: number | number
}

export type DefinePoolReturnType<key = number> = Pool<key>

/**
 * Defines an instance pool. Instances can be started, cached, and stopped against an identifier.
 *
 * @example
 * ```
 * const pool = definePool({
 *  instance: anvil(),
 * })
 *
 * const instance_1 = await pool.start(1)
 * const instance_2 = await pool.start(2)
 * const instance_3 = await pool.start(3)
 * ```
 */
export function definePool<key = number>(
  parameters: DefinePoolParameters,
): DefinePoolReturnType<key> {
  const { instance, limit } = parameters

  type Instance_ = Omit<Instance, 'create'>
  const instances = new Map<key, Instance_>()

  // Define promise instances for mutators to avoid race conditions, and return
  // identical instances of the promises (instead of duplicating them).
  // We utilize `Promise.withResolvers` instead of `new Promise((resolve, reject) => ...)`
  // to avoid async Promise executor functions (https://biomejs.dev/linter/rules/no-async-promise-executor/).
  const promises = {
    destroy: new Map<key, Promise<void>>(),
    destroyAll: undefined as Promise<void> | undefined,
    start: new Map<key, Promise<Instance_>>(),
    stop: new Map<key, Promise<void>>(),
    stopAll: undefined as Promise<void> | undefined,
  }

  return {
    _internal: {
      instance,
    },
    async destroy(key) {
      const destroyPromise = promises.destroy.get(key)
      if (destroyPromise) return destroyPromise

      const resolver = Promise.withResolvers<void>()

      try {
        promises.destroy.set(key, resolver.promise)

        await this.stop(key)
        instances.delete(key)

        resolver.resolve()
      } catch (error) {
        resolver.reject(error)
      }

      return resolver.promise
    },
    async destroyAll() {
      if (promises.destroyAll) return promises.destroyAll

      const resolver = Promise.withResolvers<void>()

      try {
        promises.destroyAll = resolver.promise

        await Promise.all([...instances.keys()].map((key) => this.destroy(key)))

        promises.destroyAll = undefined

        resolver.resolve()
      } catch (error) {
        resolver.reject(error)
      }
    },
    async start(key, options = {}) {
      const startPromise = promises.start.get(key)
      if (startPromise) return startPromise

      const resolver = Promise.withResolvers<Instance_>()

      try {
        promises.start.set(key, resolver.promise)

        if (limit && instances.size >= limit)
          throw new Error(`Instance limit of ${limit} reached.`)

        const { port = await getPort() } = options

        const instance_ = instances.get(key) || instance.create({ port })
        await instance_.start()

        instances.set(key, instance_)
        resolver.resolve(instance_)
      } catch (error) {
        resolver.reject(error)
      } finally {
        promises.start.delete(key)
      }

      return resolver.promise
    },
    async stop(key) {
      const stopPromise = promises.stop.get(key)
      if (stopPromise) return stopPromise

      const resolver = Promise.withResolvers<void>()

      try {
        promises.stop.set(key, resolver.promise)

        const instance_ = instances.get(key)
        if (!instance_) {
          resolver.resolve()
          return
        }

        await instance_.stop()

        resolver.resolve()
      } catch (error) {
        resolver.reject(error)
      } finally {
        promises.stop.delete(key)
      }
    },
    async stopAll() {
      if (promises.stopAll) return promises.stopAll

      const resolver = Promise.withResolvers<void>()

      try {
        promises.stopAll = resolver.promise

        await Promise.all([...instances.keys()].map((key) => this.stop(key)))

        promises.stopAll = undefined

        resolver.resolve()
      } catch (error) {
        resolver.reject(error)
      }
    },

    get size() {
      return instances.size
    },
    entries: instances.entries.bind(instances),
    keys: instances.keys.bind(instances),
    forEach: instances.forEach.bind(instances),
    get: instances.get.bind(instances).bind(instances),
    has: instances.has.bind(instances),
    values: instances.values.bind(instances),
  }
}
