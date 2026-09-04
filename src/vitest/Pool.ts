import type { Instance } from '../Instance.js'
import * as Pool from '../Pool.js'

type StartedInstance<
  definition extends Instance | ((poolId: number) => Instance),
> = definition extends (poolId: number) => infer instance
  ? StartedInstance<Extract<instance, Instance>>
  : definition extends Instance
    ? Awaited<ReturnType<Pool.Pool<number, definition>['start']>>
    : never

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

/** Starts an isolated instance per worker, or per name and worker. */
export function setup<
  const instances extends Record<
    string,
    Instance | ((poolId: number) => Instance)
  >,
  project extends setup.Project = setup.Project,
>(
  parameters: setup.NamedParameters<instances, project>,
): setup.ReturnType<project>
export function setup<
  instance extends Instance = Instance,
  project extends setup.Project = setup.Project,
>(parameters: setup.Parameters<instance, project>): setup.ReturnType<project>
export function setup<
  const instances extends Record<
    string,
    Instance | ((poolId: number) => Instance)
  >,
  instance extends Instance = Instance,
  project extends setup.Project = setup.Project,
>(
  parameters:
    | setup.Parameters<instance, project>
    | setup.NamedParameters<instances, project>,
): setup.ReturnType<project> {
  return async (project) => {
    const { maxWorkers } = project.config
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1)
      throw new Error('Vitest maxWorkers must be a positive integer.')

    const definitions =
      'instances' in parameters
        ? parameters.instances
        : { default: parameters.instance }
    const pools = Object.entries(definitions).map(([name, instance]) => ({
      name,
      pool: Pool.define({ instance, limit: maxWorkers }),
    }))
    const starts = Array.from({ length: maxWorkers }, (_, index) =>
      pools.map(
        async ({ name, pool }) => [name, await pool.start(index + 1)] as const,
      ),
    )

    async function stop() {
      const results = await Promise.allSettled(
        pools.map(({ pool }) => pool.destroyAll()),
      )
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      )
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1)
        throw new AggregateError(errors, 'Failed to destroy Vitest pools.')
    }

    try {
      const instances = await Promise.all(
        starts.map((entries) => Promise.all(entries)),
      )
      if ('instances' in parameters)
        await parameters.setup(
          instances.map((entries) =>
            Object.fromEntries(entries),
          ) as setup.Instances<instances>[],
          project,
        )
      else
        await parameters.setup(
          instances.map(
            (entries) => entries[0]![1],
          ) as StartedInstance<instance>[],
          project,
        )
      return stop
    } catch (error) {
      // A sibling may still start after Promise.all rejects.
      await Promise.allSettled(starts.flat())
      try {
        await stop()
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
  /** Started instances for one worker, preserving each definition's endpoint types. */
  export type Instances<
    instances extends Record<string, Instance | ((poolId: number) => Instance)>,
  > = {
    [name in keyof instances]: StartedInstance<instances[name]>
  }

  /** Options for named eager pools with one instance per name and worker. */
  export type NamedParameters<
    instances extends Record<string, Instance | ((poolId: number) => Instance)>,
    project extends Project = Project,
  > = {
    /** Definitions or worker-ID factories keyed by instance name. */
    instances: instances
    /** Receives worker-ordered records after every instance starts. */
    setup(
      instances: readonly Instances<instances>[],
      project: project,
    ): Promise<void> | void
  }

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
