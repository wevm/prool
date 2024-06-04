import getPort from 'get-port'

import type { Instance } from './instance.js'

type Instance_ = Omit<Instance, 'create'>

export type Pool<key extends number | string = number | string> = Pick<
  Map<key, Instance_>,
  'entries' | 'keys' | 'forEach' | 'get' | 'has' | 'size' | 'values'
> & {
  _internal: {
    instance: Instance_ | ((key: key) => Instance_)
  }
  destroy(key: key): Promise<void>
  destroyAll(): Promise<void>
  restart(key: key): Promise<void>
  start(key: key, options?: { port?: number }): Promise<Instance_>
  stop(key: key): Promise<void>
  stopAll(): Promise<void>
}

export type DefinePoolParameters<
  key extends number | string = number | string,
> = {
  /** Instance for the pool. */
  instance: Instance | ((key: key) => Instance)
  /** The maximum number of instances that can be started. */
  limit?: number | number
}

export type DefinePoolReturnType<
  key extends number | string = number | string,
> = Pool<key>

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
export function definePool<key extends number | string = number>(
  parameters: DefinePoolParameters<key>,
): DefinePoolReturnType<key> {
  const { limit } = parameters

  type Instance_ = Omit<Instance, 'create'>
  const instances = new Map<key, Instance_>()

  // Define promise instances for mutators to avoid race conditions, and return
  // identical instances of the promises (instead of duplicating them).
  // We utilize `Promise.withResolvers` instead of `new Promise((resolve, reject) => ...)`
  // to avoid async Promise executor functions (https://biomejs.dev/linter/rules/no-async-promise-executor/).
  const promises = {
    destroy: new Map<key, Promise<void>>(),
    destroyAll: undefined as Promise<void> | undefined,
    restart: new Map<key, Promise<void>>(),
    start: new Map<key, Promise<Instance_>>(),
    stop: new Map<key, Promise<void>>(),
    stopAll: undefined as Promise<void> | undefined,
  }

  return {
    _internal: {
      instance: parameters.instance,
    },
    async destroy(key) {
      const destroyPromise = promises.destroy.get(key)
      if (destroyPromise) return destroyPromise

      const resolver = Promise.withResolvers<void>()

      promises.destroy.set(key, resolver.promise)

      this.stop(key)
        .then(() => {
          instances.delete(key)
          resolver.resolve()
        })
        .catch(resolver.reject)

      return resolver.promise
    },
    async destroyAll() {
      if (promises.destroyAll) return promises.destroyAll

      const resolver = Promise.withResolvers<void>()

      promises.destroyAll = resolver.promise

      Promise.all([...instances.keys()].map((key) => this.destroy(key)))
        .then(() => {
          promises.destroyAll = undefined
          resolver.resolve()
        })
        .catch(resolver.reject)

      return resolver.promise
    },
    async restart(key) {
      const restartPromise = promises.restart.get(key)
      if (restartPromise) return restartPromise

      const resolver = Promise.withResolvers<void>()

      const instance_ = instances.get(key)
      if (!instance_) return

      promises.restart.set(key, resolver.promise)

      instance_
        .restart()
        .then(resolver.resolve)
        .catch(resolver.reject)
        .finally(() => promises.restart.delete(key))

      return resolver.promise
    },
    async start(key, options = {}) {
      const startPromise = promises.start.get(key)
      if (startPromise) return startPromise

      const resolver = Promise.withResolvers<Instance_>()

      if (limit && instances.size >= limit)
        throw new Error(`Instance limit of ${limit} reached.`)

      promises.start.set(key, resolver.promise)

      const instance =
        typeof parameters.instance === 'function'
          ? parameters.instance(key)
          : parameters.instance
      const { port = await getPort() } = options

      const instance_ = instances.get(key) || instance.create({ port })
      instance_
        .start()
        .then(() => {
          instances.set(key, instance_)
          resolver.resolve(instance_)
        })
        .catch(resolver.reject)
        .finally(() => promises.start.delete(key))

      return resolver.promise
    },
    async stop(key) {
      const stopPromise = promises.stop.get(key)
      if (stopPromise) return stopPromise

      const instance_ = instances.get(key)
      if (!instance_) return

      const resolver = Promise.withResolvers<void>()

      promises.stop.set(key, resolver.promise)
      instance_
        .stop()
        .then(resolver.resolve)
        .catch(resolver.reject)
        .finally(() => promises.stop.delete(key))

      return resolver.promise
    },
    async stopAll() {
      if (promises.stopAll) return promises.stopAll

      const resolver = Promise.withResolvers<void>()

      promises.stopAll = resolver.promise

      Promise.all([...instances.keys()].map((key) => this.stop(key)))
        .then(() => {
          promises.stopAll = undefined
          resolver.resolve()
        })
        .catch(resolver.reject)

      return resolver.promise
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
