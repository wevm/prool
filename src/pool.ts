import type { Instance } from './instance.js'

export type DefinePoolParameters = {
  instance: Instance
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
export function definePool(parameters: DefinePoolParameters) {
  const { instance } = parameters

  return {
    _internal: {
      instance,
    },
  }
}
