import type { Instance } from '../Instance.js'
import * as Pool from '../Pool.js'

type StartedInstance<instance extends Instance> = Awaited<
  ReturnType<Pool.Pool<number, instance>['start']>
>

/** Returns the value provided for the current Vitest pool. */
export function get<const value>(values: readonly value[]): value {
  const id = poolId()
  const index = id - 1
  if (index >= values.length)
    throw new Error(`Missing value for Vitest pool ${id}.`)
  return values[index]!
}

/** Returns the current Vitest pool ID. */
export function poolId(): number {
  const value = process.env['VITEST_POOL_ID']
  if (value === undefined) throw new Error('VITEST_POOL_ID is not set.')

  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1)
    throw new Error(`Invalid VITEST_POOL_ID "${value}".`)
  return id
}

/** Creates Vitest global setup with one instance per worker. */
export function setup<
  instance extends Instance = Instance,
  project extends setup.Project = setup.Project,
>(parameters: setup.Parameters<instance, project>): setup.ReturnType<project> {
  return async (project) => {
    const { maxWorkers } = project.config
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1)
      throw new Error('Vitest maxWorkers must be a positive integer.')

    const pool = Pool.define({
      instance: parameters.instance,
      limit: maxWorkers,
    })
    const starts = Array.from({ length: maxWorkers }, (_, index) =>
      pool.start(index + 1),
    )

    try {
      const instances = await Promise.all(starts)
      await parameters.setup(instances, project)
      return () => pool.destroyAll()
    } catch (error) {
      await Promise.allSettled(starts)
      try {
        await pool.destroyAll()
      } catch (destroyError) {
        throw new AggregateError(
          [error, destroyError],
          'Failed to set up or destroy Vitest pool.',
        )
      }
      throw error
    }
  }
}

export declare namespace setup {
  /** Options for setting up a Vitest worker pool. */
  export type Parameters<
    instance extends Instance = Instance,
    project extends Project = Project,
  > = {
    /** Instance created for each Vitest pool ID. */
    instance: instance | ((poolId: number) => instance)
    /** Configures serializable context provided to every worker. */
    setup(
      instances: readonly StartedInstance<instance>[],
      project: project,
    ): Promise<void> | void
  }

  /** Minimal Vitest project interface used by global setup. */
  export type Project = {
    config: {
      maxWorkers: number
    }
    provide(key: string, value: unknown): void
  }

  /** Vitest global setup function. */
  export type ReturnType<project extends Project = Project> = (
    project: project,
  ) => Promise<() => Promise<void>>
}
