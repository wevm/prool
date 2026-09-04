import * as Http from 'node:http'
import { Instance } from 'prool'
import { Server } from 'prool/vitest'
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('get', () => {
  test('isolates named instances and workers over HTTP', async () => {
    const definition = Instance.define(
      (options: { name: string; worker: number }) => {
        let requests = 0
        const server = Http.createServer((_request, response) => {
          response.end(JSON.stringify({ ...options, requests: ++requests }))
        })
        return {
          host: '127.0.0.1',
          name: options.name,
          port: 0,
          async start({ port }) {
            await new Promise<void>((resolve) =>
              server.listen(port, '127.0.0.1', resolve),
            )
          },
          async stop() {
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            )
          },
        }
      },
    )
    const { context, project } = testProject(2)
    const setup = Server.setup({
      instances: {
        l1: (worker) => definition({ name: 'l1', worker }),
        l2: (worker) => definition({ name: 'l2', worker }),
      },
      setup(servers, project) {
        project.provide('servers', servers)
      },
    })
    const teardown = await setup(project)
    try {
      const contexts = context.get('servers') as {
        l1: Server.Context
        l2: Server.Context
      }
      expect(contexts.l1.url).not.toBe(contexts.l2.url)
      vi.stubEnv('VITEST_POOL_ID', '1')
      const first = Server.get(contexts)
      vi.stubEnv('VITEST_POOL_ID', '2')
      const second = Server.get(contexts)

      expect(
        await Promise.all(
          [first.l1, first.l2, second.l1, second.l2].map(async (server) =>
            (await fetch(server.url)).json(),
          ),
        ),
      ).toEqual([
        { name: 'l1', worker: 1, requests: 1 },
        { name: 'l2', worker: 1, requests: 1 },
        { name: 'l1', worker: 2, requests: 1 },
        { name: 'l2', worker: 2, requests: 1 },
      ])
      await first.l1.reset()
      expect(await (await fetch(first.l1.url)).json()).toEqual({
        name: 'l1',
        worker: 1,
        requests: 1,
      })
      expect(await (await fetch(first.l2.url)).json()).toEqual({
        name: 'l2',
        worker: 1,
        requests: 2,
      })
      expect(await (await fetch(second.l1.url)).json()).toEqual({
        name: 'l1',
        worker: 2,
        requests: 2,
      })
      await first.l2.restart()
      expect(await (await fetch(first.l2.url)).json()).toEqual({
        name: 'l2',
        worker: 1,
        requests: 3,
      })
      expect(await (await fetch(second.l2.url)).json()).toEqual({
        name: 'l2',
        worker: 2,
        requests: 2,
      })
    } finally {
      await teardown()
    }
  })

  test('supports instance names that match context properties', () => {
    vi.stubEnv('VITEST_POOL_ID', '2')
    const servers = Server.get({
      url: { url: 'http://localhost:3000/' },
      default: { url: 'http://localhost:4000' },
    })
    expect(servers.url.url).toBe('http://localhost:3000/2')
    expect(servers.default.url).toBe('http://localhost:4000/2')
  })

  test('controls the current worker instance', async () => {
    vi.stubEnv('VITEST_POOL_ID', '2')
    const started: number[] = []
    const stopped: number[] = []
    const { context, project } = testProject(3)
    const setup = Server.setup({
      instance: (id) =>
        Instance.define(() => ({
          host: 'localhost',
          name: `worker-${id}`,
          port: 3000 + id,
          async start() {
            started.push(id)
          },
          async stop() {
            stopped.push(id)
          },
        }))(),
      setup(server, project) {
        expectTypeOf(server).toEqualTypeOf<Server.Context>()
        project.provide('server', server)
      },
    })
    const teardown = await setup(project)
    const server = Server.get(context.get('server') as Server.Context)

    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/2$/)
    expect(started).toEqual([])

    await fetch(`${server.url}/start`, { method: 'POST' }).then((response) =>
      response.text(),
    )
    expect(started).toEqual([2])

    await server.restart()
    expect(started).toEqual([2, 2])
    expect(stopped).toEqual([2])

    await server.reset({ signal: AbortSignal.timeout(1_000) })
    expect(stopped).toEqual([2, 2])

    await fetch(`${server.url}/start`, { method: 'POST' }).then((response) =>
      response.text(),
    )
    expect(started).toEqual([2, 2, 2])

    await teardown()
    expect(stopped).toEqual([2, 2, 2])
  })

  test('reports control failures', async () => {
    vi.stubEnv('VITEST_POOL_ID', '1')
    let stops = 0
    const { context, project } = testProject(1)
    const setup = Server.setup({
      instance: Instance.define(() => ({
        host: 'localhost',
        name: 'worker',
        port: 3000,
        async start() {},
        async stop() {
          stops++
          if (stops === 1) throw new Error('stop failed')
        },
      }))(),
      setup(server, project) {
        project.provide('server', server)
      },
    })
    const teardown = await setup(project)
    const server = Server.get(context.get('server') as Server.Context)
    await fetch(`${server.url}/start`, { method: 'POST' }).then((response) =>
      response.text(),
    )

    await expect(server.restart()).rejects.toThrowError(
      'Failed to restart Vitest server: {"message":"stop failed"}',
    )

    await teardown()
  })
})

describe('setup', () => {
  test('cleans up every named server when setup fails', async () => {
    const stopped: string[] = []
    const definition = Instance.define((name: string) => ({
      host: 'localhost',
      name,
      port: 3000,
      async start() {},
      async stop() {
        stopped.push(name)
      },
    }))
    const contexts: Server.Context[] = []
    const setup = Server.setup({
      instances: { l1: definition('l1'), l2: definition('l2') },
      async setup(servers) {
        contexts.push(...Object.values(servers))
        for (const server of contexts) {
          const response = await fetch(`${server.url}/1/start`, {
            method: 'POST',
          })
          expect(response.status).toBe(200)
          await response.text()
        }
        throw new Error('setup failed')
      },
    })
    await expect(setup(testProject(1).project)).rejects.toThrowError(
      'setup failed',
    )
    expect(stopped.sort()).toEqual(['l1', 'l2'])
    for (const context of contexts)
      await expect(fetch(`${context.url}/healthcheck`)).rejects.toThrow()
  })

  test('attempts every named teardown when one fails', async () => {
    const stopped: string[] = []
    const definition = Instance.define((name: string) => ({
      host: 'localhost',
      name,
      port: 3000,
      async start() {},
      async stop() {
        stopped.push(name)
        if (name === 'l1') throw new Error('l1 stop failed')
      },
    }))
    const setup = Server.setup({
      instances: { l1: definition('l1'), l2: definition('l2') },
      async setup(servers) {
        for (const server of Object.values(servers))
          await fetch(`${server.url}/1/start`, { method: 'POST' }).then(
            (response) => response.text(),
          )
      },
    })
    const teardown = await setup(testProject(1).project)
    await expect(teardown()).rejects.toThrowError('l1 stop failed')
    expect(stopped.sort()).toEqual(['l1', 'l2'])
  })

  test('limits instances to the worker count', async () => {
    const { context, project } = testProject(1)
    const setup = Server.setup({
      instance: Instance.define(() => ({
        host: 'localhost',
        name: 'worker',
        port: 3000,
        async start() {},
        async stop() {},
      }))(),
      setup(server, project) {
        project.provide('server', server)
      },
    })
    const teardown = await setup(project)
    const server = context.get('server') as Server.Context

    const first = await fetch(`${server.url}/1/start`, { method: 'POST' })
    expect(first.status).toBe(200)
    await first.text()

    const second = await fetch(`${server.url}/2/start`, { method: 'POST' })
    expect(second.status).toBe(400)
    expect(await second.json()).toEqual({
      message: 'Instance limit of 1 reached.',
    })

    await teardown()
  })

  test('stops the server when setup fails', async () => {
    const stopped: number[] = []
    const setup = Server.setup({
      instance: (id) =>
        Instance.define(() => ({
          host: 'localhost',
          name: `worker-${id}`,
          port: 3000 + id,
          async start() {},
          async stop() {
            stopped.push(id)
          },
        }))(),
      async setup(server) {
        await fetch(`${server.url}/1/start`, { method: 'POST' }).then(
          (response) => response.text(),
        )
        throw new Error('setup failed')
      },
    })

    await expect(setup(testProject(2).project)).rejects.toThrowError(
      'setup failed',
    )
    expect(stopped).toEqual([1])
  })

  test('reports setup and teardown failures', async () => {
    const setup = Server.setup({
      instance: Instance.define(() => ({
        host: 'localhost',
        name: 'worker',
        port: 3000,
        async start() {},
        async stop() {
          throw new Error('stop failed')
        },
      }))(),
      async setup(server) {
        await fetch(`${server.url}/1/start`, { method: 'POST' }).then(
          (response) => response.text(),
        )
        throw new Error('setup failed')
      },
    })

    const error = await setup(testProject(1).project).catch((error) => error)

    expect(error).toBeInstanceOf(AggregateError)
    expect(error.errors.map((error: Error) => error.message)).toEqual([
      'setup failed',
      'stop failed',
    ])
  })

  test('requires a positive worker count', async () => {
    const setup = Server.setup({
      instance: Instance.anvil(),
      setup() {},
    })

    await expect(setup(testProject(0).project)).rejects.toThrowError(
      'Vitest maxWorkers must be a positive integer.',
    )
  })
})

function testProject(maxWorkers: number) {
  const context = new Map<string, unknown>()
  return {
    context,
    project: {
      config: { maxWorkers },
      provide(key: string, value: unknown) {
        context.set(key, value)
      },
    },
  }
}
