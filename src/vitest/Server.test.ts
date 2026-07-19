import { Instance } from 'prool'
import { Server } from 'prool/vitest'
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('get', () => {
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
