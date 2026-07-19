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

/** Returns the server URL and controls for the current Vitest pool. */
export function get(context: Context): Server {
  const url = `${context.url.replace(/\/+$/, '')}/${Pool.poolId()}`
  return {
    url,
    reset: (options) => control(url, 'destroy', 'reset', options),
    restart: (options) => control(url, 'restart', 'restart', options),
  }
}

/** Creates Vitest global setup with a lazy keyed instance server. */
export function setup<
  instance extends Instance = Instance,
  project extends setup.Project = setup.Project,
>(parameters: setup.Parameters<instance, project>): setup.ReturnType<project> {
  return async (project) => {
    const { maxWorkers } = project.config
    if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1)
      throw new Error('Vitest maxWorkers must be a positive integer.')

    const { setup: setup_, ...serverParameters } = parameters
    const server = ProolServer.create({
      ...serverParameters,
      host: serverParameters.host ?? '127.0.0.1',
      limit: maxWorkers,
    })
    await server.start()

    const address = server.address()!
    const host = address.address.includes(':')
      ? `[${address.address}]`
      : address.address
    const context = { url: `http://${host}:${address.port}` }

    try {
      await setup_(context, project)
      return () => server.stop()
    } catch (error) {
      try {
        await server.stop()
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
