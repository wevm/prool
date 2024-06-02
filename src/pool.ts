import type { Instance } from './instance.js'

export type DefinePoolParameters = {
  instance: Instance
  /** The maximum number of instances that can be started. */
  limit?: number | number
}

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
export function definePool<key = number>(parameters: DefinePoolParameters) {
  const { instance, limit } = parameters

  const instances = new Map<key, Omit<Instance, 'create'>>()

  return {
    _internal: {
      instance,
    },
    async start(key: key) {
      let instance_ = instances.get(key)
      if (instance_) {
        await instance_.start()
        return instance_
      }

      if (limit && instances.size >= limit)
        throw new Error(`Instance limit of ${limit} reached.`)

      instance_ = instance.create()
      instances.set(key, instance_)

      await instance_.start()

      return instance_
    },

    get size() {
      return instances.size
    },
    entries: instances.entries,
    keys: instances.keys,
    forEach: instances.forEach,
    get: instances.get,
    has: instances.has,
    values: instances.values,
  }
}
