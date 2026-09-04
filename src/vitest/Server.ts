import type { Instance } from '../Instance.js'
import * as ProolServer from '../Server.js'
import * as Pool from './Pool.js'

/** Serializable server context passed from Vitest global setup. */
export type Context = {
  readonly url: string
}

/** Options for a worker-scoped server control. */
export type ControlOptions = {
  signal?: AbortSignal | undefined
}

/** Worker-scoped server URL and lifecycle controls. */
export type Server = {
  readonly url: string
  /** Destroys the instance so the next request starts a fresh one. */
  reset(options?: ControlOptions | undefined): Promise<void>
  /** Restarts the current instance in place. */
  restart(options?: ControlOptions | undefined): Promise<void>
}

/** Returns worker-scoped URLs and controls for one server or named servers. */
export function get(context: Context): Server
export function get<const contexts extends Record<string, Context>>(
  context: contexts,
): { [name in keyof contexts]: Server }
export function get(
  context: Context | Record<string, Context>,
): Server | Record<string, Server> {
  if (typeof context.url !== 'string')
    return Object.fromEntries(
      Object.entries(context as Record<string, Context>).map(
        ([name, value]) => [name, get(value)],
      ),
    )
  const url = `${context.url.replace(/\/+$/, '')}/${Pool.poolId()}`
  return {
    url,
    reset: (options) => control(url, 'destroy', 'reset', options),
    restart: (options) => control(url, 'restart', 'restart', options),
  }
}

/** Creates lazy keyed servers with an isolated instance per name and worker. */
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
    const servers: ProolServer.CreateServerReturnType[] = []
    const contexts: [string, Context][] = []

    async function stop() {
      const results = await Promise.allSettled(
        servers.map((server) => server.stop()),
      )
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      )
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1)
        throw new AggregateError(errors, 'Failed to stop Vitest servers.')
    }

    try {
      for (const [name, instance] of Object.entries(definitions)) {
        const server = ProolServer.create({
          instance,
          host: parameters.host ?? '127.0.0.1',
          port: 'instances' in parameters ? 0 : parameters.port,
          limit: maxWorkers,
        })
        await server.start()
        servers.push(server)
        const address = server.address()!
        const host = address.address.includes(':')
          ? `[${address.address}]`
          : address.address
        contexts.push([name, { url: `http://${host}:${address.port}` }])
      }
      if ('instances' in parameters)
        await parameters.setup(
          Object.fromEntries(contexts) as setup.Contexts<instances>,
          project,
        )
      else await parameters.setup(contexts[0]![1], project)
      return stop
    } catch (error) {
      try {
        await stop()
      } catch (stopError) {
        throw new AggregateError(
          [error, stopError],
          'Failed to set up or stop Vitest server.',
        )
      }
      throw error
    }
  }
}

export declare namespace setup {
  /** Serializable server contexts keyed by instance name. */
  export type Contexts<instances> = { [name in keyof instances]: Context }

  /** Options for named lazy servers, each bound to an available port. */
  export type NamedParameters<
    instances extends Record<string, Instance | ((poolId: number) => Instance)>,
    project extends Project = Project,
  > = {
    /** Definitions or worker-ID factories keyed by instance name. */
    instances: instances
    /** Host for every proxy server. Defaults to `127.0.0.1`. */
    host?: string | undefined
    /** Provides named serializable contexts after every proxy starts. */
    setup(contexts: Contexts<instances>, project: project): Promise<void> | void
  }

  /** Options for setting up a lazy Vitest instance server. */
  export type Parameters<
    instance extends Instance = Instance,
    project extends Project = Project,
  > = Omit<ProolServer.CreateServerParameters<instance>, 'limit'> & {
    /** Configures serializable context provided to every worker. */
    setup(context: Context, project: project): Promise<void> | void
  }

  /** Minimal Vitest project interface used by global setup. */
  export type Project = Pool.setup.Project

  /** Vitest global setup function. */
  export type ReturnType<project extends Project = Project> =
    Pool.setup.ReturnType<project>
}

async function control(
  url: string,
  path: 'destroy' | 'restart',
  action: 'reset' | 'restart',
  options: ControlOptions = {},
) {
  const response = await fetch(`${url}/${path}`, {
    method: 'POST',
    ...(options.signal ? { signal: options.signal } : {}),
  })
  const body = await response.text()
  if (!response.ok)
    throw new Error(
      `Failed to ${action} Vitest server${body ? `: ${body}` : '.'}`,
    )
}
