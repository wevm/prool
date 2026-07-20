import { resolve } from 'node:path'
import { Sweep } from 'prool/testcontainers'
import type { ContainerRuntimeClient } from 'testcontainers'
import { expect, test, vi } from 'vitest'

type ContainerFixture = {
  Created: number
  Id: string
  Labels: Record<string, string>
}

function client(parameters: {
  containers: ContainerFixture[]
  networks: Record<string, { Id: string }[]>
}) {
  const containerFilters: unknown[] = []
  const removedContainers: string[] = []
  const removedNetworks: string[] = []
  const remove = vi.fn(async (container: { id: string }) => {
    removedContainers.push(container.id)
  })
  const runtime = {
    container: {
      dockerode: {
        getNetwork(id: string) {
          return {
            async remove() {
              removedNetworks.push(id)
            },
          }
        },
        async listContainers(options: { filters: unknown }) {
          containerFilters.push(options.filters)
          return parameters.containers
        },
        async listNetworks(options: {
          filters: { label: [`com.docker.compose.project=${string}`] }
        }) {
          const project = options.filters.label[0].split('=')[1] as string
          return parameters.networks[project] ?? []
        },
      },
      getById: (id: string) => ({ id }),
      remove,
    },
  }
  return {
    client: runtime as unknown as ContainerRuntimeClient,
    containerFilters,
    remove,
    removedContainers,
    removedNetworks,
  }
}

test('removes stale sessions and their networks, scoped by compose file', async () => {
  const { client: runtime, ...calls } = client({
    containers: [
      {
        Created: 100,
        Id: 'stale-postgres',
        Labels: { 'com.docker.compose.project': 'testcontainers-aaa' },
      },
      {
        Created: 100,
        Id: 'stale-api',
        Labels: { 'com.docker.compose.project': 'testcontainers-aaa' },
      },
      {
        Created: 980,
        Id: 'young-postgres',
        Labels: { 'com.docker.compose.project': 'testcontainers-bbb' },
      },
    ],
    networks: {
      'testcontainers-aaa': [{ Id: 'network-aaa' }],
    },
  })

  const result = await Sweep.compose({
    client: runtime,
    composeFile: 'test/compose.yaml',
    now: 1_000_000,
  })

  expect(result).toEqual({ containers: 2, networks: 1 })
  expect(calls.removedContainers).toEqual(['stale-postgres', 'stale-api'])
  expect(calls.removedNetworks).toEqual(['network-aaa'])
  // Docker filters restrict the listing to this file's stopped sessions.
  expect(calls.containerFilters).toEqual([
    {
      label: [
        `com.docker.compose.project.config_files=${resolve('test/compose.yaml')}`,
      ],
      status: ['created', 'dead', 'exited'],
    },
  ])
})

test('keeps sessions younger than the age floor', async () => {
  const { client: runtime, ...calls } = client({
    containers: [
      {
        Created: 970,
        Id: 'starting-postgres',
        Labels: { 'com.docker.compose.project': 'testcontainers-ccc' },
      },
    ],
    networks: { 'testcontainers-ccc': [{ Id: 'network-ccc' }] },
  })

  const result = await Sweep.compose({
    client: runtime,
    composeFile: 'compose.yaml',
    now: 1_000_000,
  })

  expect(result).toEqual({ containers: 0, networks: 0 })
  expect(calls.removedContainers).toEqual([])
  expect(calls.removedNetworks).toEqual([])
})

test('counts only removals that succeed', async () => {
  const { client: runtime, ...calls } = client({
    containers: [
      {
        Created: 100,
        Id: 'stale-postgres',
        Labels: { 'com.docker.compose.project': 'testcontainers-ddd' },
      },
    ],
    networks: { 'testcontainers-ddd': [{ Id: 'network-ddd' }] },
  })
  calls.remove.mockRejectedValueOnce(new Error('no such container'))

  const result = await Sweep.compose({
    client: runtime,
    composeFile: 'compose.yaml',
    now: 1_000_000,
  })

  expect(result).toEqual({ containers: 0, networks: 1 })
  expect(calls.removedNetworks).toEqual(['network-ddd'])
})
