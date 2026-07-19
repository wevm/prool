import * as os from 'node:os'
import getPort from 'get-port'

import type { Instance } from './Instance.js'

type StartedInstance<instance extends Instance> = ReturnType<instance['create']>

export type Lease<instance extends Instance = Instance> = {
  instance: StartedInstance<instance>
  release(): Promise<void>
}

export type LeasePool<instance extends Instance = Instance> = {
  acquire(): Promise<Lease<instance>>
  close(): Promise<void>
  readonly size: number
}

export type Pool<
  key extends number | string = number | string,
  instance extends Instance = Instance,
> = Pick<
  Map<key, StartedInstance<instance>>,
  'entries' | 'keys' | 'forEach' | 'get' | 'has' | 'size' | 'values'
> & {
  _internal: {
    instance: instance | ((key: key) => instance)
  }
  destroy(key: key): Promise<void>
  destroyAll(): Promise<void>
  restart(key: key): Promise<void>
  start(
    key: key,
    options?: { port?: number | undefined } | undefined,
  ): Promise<StartedInstance<instance>>
  stop(key: key): Promise<void>
  stopAll(): Promise<void>
}

/**
 * Creates a pool of exclusively leased instances.
 *
 * @example
 * ```ts
 * const pool = Pool.create({ instance: anvil() })
 * const lease = await pool.acquire()
 * try {
 *   // Use lease.instance.
 * } finally {
 *   await lease.release()
 * }
 * await pool.close()
 * ```
 */
export function create<instance extends Instance = Instance>(
  parameters: create.Parameters<instance>,
): create.ReturnType<instance> {
  const limit =
    parameters.limit ?? Math.max(1, Math.floor(os.availableParallelism() / 2))
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('Pool limit must be a positive integer.')

  const available = Array.from({ length: limit }, (_, index) => index + 1)
  const leases = new Set<number>()
  const operations = new Set<Promise<unknown>>()
  const pool = define<number, instance>({
    instance: parameters.instance,
    limit,
  })
  const waiters: PromiseWithResolvers<Lease<instance>>[] = []
  let closePromise: Promise<void> | undefined
  let closed = false

  function rejectWaiters(error: Error) {
    for (const waiter of waiters) waiter.reject(error)
    waiters.length = 0
  }

  function track<const value>(promise: Promise<value>): Promise<value> {
    operations.add(promise)
    promise.then(
      () => operations.delete(promise),
      () => operations.delete(promise),
    )
    return promise
  }

  async function grant(slot: number): Promise<Lease<instance>> {
    const instance_ = pool.get(slot) ?? (await pool.start(slot))
    if (closed) throw new Error('Pool is closed.')
    leases.add(slot)
    let releasePromise: Promise<void> | undefined
    return {
      instance: instance_,
      release() {
        releasePromise ??= track(release(slot, instance_))
        return releasePromise
      },
    }
  }

  function dispatch(slot: number) {
    if (closed) return
    const waiter = waiters.shift()
    if (!waiter) {
      available.push(slot)
      return
    }
    track(grant(slot)).then(waiter.resolve, (error) => {
      waiter.reject(error)
      dispatch(slot)
    })
  }

  async function release(slot: number, instance_: StartedInstance<instance>) {
    if (!leases.delete(slot) || closed) return
    try {
      await parameters.reset?.(instance_)
    } catch (error) {
      try {
        await pool.destroy(slot)
      } catch (destroyError) {
        const failure = new AggregateError(
          [error, destroyError],
          'Failed to reset or destroy pooled instance.',
        )
        closed = true
        rejectWaiters(failure)
        throw failure
      }
      dispatch(slot)
      throw error
    }
    dispatch(slot)
  }

  return {
    async acquire() {
      if (closed) throw new Error('Pool is closed.')
      const slot = available.shift()
      if (slot === undefined) {
        const waiter = Promise.withResolvers<Lease<instance>>()
        waiters.push(waiter)
        return waiter.promise
      }
      try {
        return await track(grant(slot))
      } catch (error) {
        dispatch(slot)
        throw error
      }
    },
    close() {
      if (closePromise) return closePromise
      closed = true
      rejectWaiters(new Error('Pool is closed.'))
      closePromise = (async () => {
        await Promise.allSettled([...operations])
        await pool.destroyAll()
      })()
      return closePromise
    },
    get size() {
      return pool.size
    },
  }
}

export declare namespace create {
  export type Parameters<instance extends Instance = Instance> = {
    /** Instance to lease. */
    instance: instance
    /** Maximum concurrent leases. Defaults to half the available logical CPUs. */
    limit?: number | undefined
    /** Resets an instance before it is leased again. */
    reset?:
      | ((instance: StartedInstance<instance>) => Promise<void> | void)
      | undefined
  }

  export type ReturnType<instance extends Instance = Instance> =
    LeasePool<instance>
}

/**
 * Defines an instance pool. Instances can be started, cached, and stopped against an identifier.
 *
 * @example
 * ```
 * const pool = Pool.define({
 *  instance: anvil(),
 * })
 *
 * const instance_1 = await pool.start(1)
 * const instance_2 = await pool.start(2)
 * const instance_3 = await pool.start(3)
 * ```
 */
export function define<
  key extends number | string = number,
  instance extends Instance = Instance,
>(
  parameters: define.Parameters<key, instance>,
): define.ReturnType<key, instance> {
  const { limit } = parameters

  type Instance_ = StartedInstance<instance>
  const creating = new Set<key>()
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

      const operation = (async () => {
        await Promise.allSettled([
          promises.restart.get(key),
          promises.start.get(key),
        ])
        await this.stop(key)
      })()
      operation
        .then(() => {
          instances.delete(key)
          promises.destroy.delete(key)
          resolver.resolve()
        })
        .catch((error) => {
          promises.destroy.delete(key)
          resolver.reject(error)
        })

      return resolver.promise
    },
    async destroyAll() {
      if (promises.destroyAll) return promises.destroyAll

      const resolver = Promise.withResolvers<void>()

      promises.destroyAll = resolver.promise

      const keys = new Set([...instances.keys(), ...creating])
      Promise.allSettled([...keys].map((key) => this.destroy(key))).then(
        (results) => {
          const errors = results.flatMap((result) =>
            result.status === 'rejected' ? [result.reason] : [],
          )
          promises.destroyAll = undefined
          if (errors.length === 0) resolver.resolve()
          else if (errors.length === 1) resolver.reject(errors[0])
          else
            resolver.reject(
              new AggregateError(errors, 'Failed to destroy pool.'),
            )
        },
      )

      return resolver.promise
    },
    async restart(key) {
      const destroyPromise = promises.destroy.get(key)
      if (destroyPromise) await destroyPromise

      const restartPromise = promises.restart.get(key)
      if (restartPromise) return restartPromise

      const resolver = Promise.withResolvers<void>()

      const instance_ = instances.get(key)
      if (!instance_) return

      promises.restart.set(key, resolver.promise)

      instance_
        .restart()
        .then(() => {
          promises.restart.delete(key)
          resolver.resolve()
        })
        .catch((error) => {
          promises.restart.delete(key)
          resolver.reject(error)
        })

      return resolver.promise
    },
    async start(key, options = {}) {
      if (promises.destroyAll)
        throw new Error('Cannot start an instance while destroying the pool.')

      const destroyPromise = promises.destroy.get(key)
      if (destroyPromise) await destroyPromise

      if (promises.destroyAll)
        throw new Error('Cannot start an instance while destroying the pool.')

      const startPromise = promises.start.get(key)
      if (startPromise) return startPromise

      const resolver = Promise.withResolvers<Instance_>()

      const isNew = !instances.has(key)
      if (isNew && limit && instances.size + creating.size >= limit)
        throw new Error(`Instance limit of ${limit} reached.`)

      promises.start.set(key, resolver.promise)
      if (isNew) creating.add(key)

      try {
        const instance =
          typeof parameters.instance === 'function'
            ? parameters.instance(key)
            : parameters.instance
        const { port = await getPort() } = options

        const instance_ =
          instances.get(key) || (instance.create({ port }) as Instance_)
        instance_
          .start()
          .then(() => {
            instances.set(key, instance_)
            creating.delete(key)
            promises.start.delete(key)
            resolver.resolve(instance_)
          })
          .catch((error) => {
            creating.delete(key)
            promises.start.delete(key)
            resolver.reject(error)
          })
      } catch (error) {
        creating.delete(key)
        promises.start.delete(key)
        resolver.reject(error)
      }

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
        .then(() => {
          promises.stop.delete(key)
          resolver.resolve()
        })
        .catch((error) => {
          promises.stop.delete(key)
          resolver.reject(error)
        })

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
        .catch((error) => {
          promises.stopAll = undefined
          resolver.reject(error)
        })

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

export declare namespace define {
  export type Parameters<
    key extends number | string = number | string,
    instance extends Instance = Instance,
  > = {
    /** Instance for the pool. */
    instance: instance | ((key: key) => instance)
    /** The maximum number of instances that can be started. */
    limit?: number | undefined
  }

  export type ReturnType<
    key extends number | string = number | string,
    instance extends Instance = Instance,
  > = Pool<key, instance>
}
