import { resolve } from 'node:path'
import {
  type ContainerRuntimeClient,
  getContainerRuntimeClient,
} from 'testcontainers'

/**
 * Removes Compose containers and networks that interrupted runs left behind.
 *
 * Testcontainers' reaper only cleans sessions whose reaper container outlives
 * them; a killed daemon, host reboot, or removed reaper orphans its sessions
 * permanently. Run this before creating a pool to clear that residue.
 *
 * Only sessions created from `composeFile` are touched, so other projects'
 * sessions survive. Running containers and sessions younger than `minAgeMs`
 * are kept: a concurrent run's containers pass through `created` on startup.
 *
 * @example
 * ```ts
 * import { Sweep } from 'prool/testcontainers'
 *
 * await Sweep.compose({ composeFile: 'test/compose.yaml' })
 * ```
 */
export async function compose(
  parameters: compose.Parameters,
): Promise<compose.ReturnType> {
  const {
    client = await getContainerRuntimeClient(),
    minAgeMs = 60_000,
    now = Date.now(),
  } = parameters
  // Compose stamps each session with the absolute path of its config file.
  const configFile = resolve(parameters.composeFile)
  const stale = await client.container.dockerode.listContainers({
    all: true,
    filters: {
      label: [`com.docker.compose.project.config_files=${configFile}`],
      status: ['created', 'dead', 'exited'],
    },
  })

  const projects = new Set<string>()
  let containers = 0
  for (const info of stale) {
    if (now / 1_000 - info.Created < minAgeMs / 1_000) continue
    const project = info.Labels['com.docker.compose.project']
    if (project) projects.add(project)
    // Removals race the reaper and sibling sweeps; a missing container is fine.
    await client.container
      .remove(client.container.getById(info.Id))
      .then(() => containers++)
      .catch(() => {})
  }

  let networks = 0
  for (const project of projects) {
    const orphaned = await client.container.dockerode.listNetworks({
      filters: { label: [`com.docker.compose.project=${project}`] },
    })
    // A network still serving a live container refuses removal; leave it.
    for (const network of orphaned)
      await client.container.dockerode
        .getNetwork(network.Id)
        .remove()
        .then(() => networks++)
        .catch(() => {})
  }

  return { containers, networks }
}

export declare namespace compose {
  export type Parameters = {
    /** Container runtime client. Defaults to the Testcontainers runtime. */
    client?: ContainerRuntimeClient | undefined
    /** Path to the Compose file whose sessions are swept. */
    composeFile: string
    /** Sessions younger than this are kept, in milliseconds. @default 60_000 */
    minAgeMs?: number | undefined
    /** Current epoch milliseconds, for deterministic tests. */
    now?: number | undefined
  }

  export type ReturnType = {
    /** Containers removed. */
    containers: number
    /** Networks removed. */
    networks: number
  }
}
