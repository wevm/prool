import { Instance } from 'prool'
import { Pool } from 'prool/vitest'
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('get', () => {
  test('returns the value for the current pool', () => {
    vi.stubEnv('VITEST_POOL_ID', '2')

    expect(Pool.get(['first', 'second', 'third'])).toBe('second')
  })

  test('throws when the current pool has no value', () => {
    vi.stubEnv('VITEST_POOL_ID', '3')

    expect(() => Pool.get(['first', 'second'])).toThrowError(
      'Missing value for Vitest pool 3.',
    )
  })
})

describe('poolId', () => {
  test('returns the current pool ID', () => {
    vi.stubEnv('VITEST_POOL_ID', '3')

    expect(Pool.poolId()).toBe(3)
  })

  test.each(['0', '-1', '1.5', 'worker'])('rejects %s', (value) => {
    vi.stubEnv('VITEST_POOL_ID', value)

    expect(() => Pool.poolId()).toThrowError(
      `Invalid VITEST_POOL_ID "${value}".`,
    )
  })

  test('requires VITEST_POOL_ID', () => {
    vi.stubEnv('VITEST_POOL_ID', undefined)

    expect(() => Pool.poolId()).toThrowError('VITEST_POOL_ID is not set.')
  })
})

describe('setup', () => {
  test('starts each named instance for every worker', async () => {
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
    const { context, project } = testProject(2)
    const setup = Pool.setup({
      instances: {
        l1: (id) => definition(`l1-${id}`),
        l2: (id) => definition(`l2-${id}`),
      },
      setup(instances, project) {
        expect(instances.map(({ l1, l2 }) => [l1.name, l2.name])).toEqual([
          ['l1-1', 'l2-1'],
          ['l1-2', 'l2-2'],
        ])
        expect(
          new Set(instances.flatMap(({ l1, l2 }) => [l1.url, l2.url])).size,
        ).toBe(4)
        project.provide(
          'names',
          instances.map(({ l1, l2 }) => ({ l1: l1.name, l2: l2.name })),
        )
      },
    })
    const teardown = await setup(project)
    try {
      vi.stubEnv('VITEST_POOL_ID', '2')
      expect(
        Pool.get(context.get('names') as readonly { l1: string; l2: string }[]),
      ).toEqual({ l1: 'l1-2', l2: 'l2-2' })
    } finally {
      await teardown()
    }
    expect(stopped.sort()).toEqual(['l1-1', 'l1-2', 'l2-1', 'l2-2'])
  })

  test('waits for late starts before cleaning up a failed named setup', async () => {
    const stopped: string[] = []
    const failed = Promise.withResolvers<void>()
    const late = Promise.withResolvers<void>()
    const definition = Instance.define((name: string) => ({
      host: 'localhost',
      name,
      port: 3000,
      async start() {
        if (name === 'l1-1') {
          failed.resolve()
          throw new Error('start failed')
        }
        await late.promise
      },
      async stop() {
        stopped.push(name)
      },
    }))
    const callback = vi.fn()
    const setup = Pool.setup({
      instances: {
        l1: (id) => definition(`l1-${id}`),
        l2: (id) => definition(`l2-${id}`),
      },
      setup: callback,
    })
    const result = setup(testProject(2).project).catch(
      (error: unknown) => error,
    )
    await failed.promise
    expect(stopped).toEqual([])
    late.resolve()
    expect(await result).toEqual(new Error('start failed'))
    expect(callback).not.toHaveBeenCalled()
    expect(stopped.sort()).toEqual(['l1-2', 'l2-1', 'l2-2'])
  })

  test.each([
    false,
    true,
  ])('cleans up named pools after callback failure, stop failure: %s', async (failStop) => {
    const stopped: string[] = []
    const definition = Instance.define((name: string) => ({
      host: 'localhost',
      name,
      port: 3000,
      async start() {},
      async stop() {
        stopped.push(name)
        if (failStop && name === 'l1') throw new Error('stop failed')
      },
    }))
    const setup = Pool.setup({
      instances: { l1: definition('l1'), l2: definition('l2') },
      setup() {
        throw new Error('setup failed')
      },
    })
    const error = await setup(testProject(1).project).catch(
      (error: unknown) => error,
    )
    if (failStop) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors).toEqual([
        new Error('setup failed'),
        new Error('stop failed'),
      ])
    } else expect(error).toEqual(new Error('setup failed'))
    expect(stopped.sort()).toEqual(['l1', 'l2'])
  })

  test('starts one instance per worker and provides setup context', async () => {
    const started: number[] = []
    const stopped: number[] = []
    const { context, project } = testProject(3)
    const setup = Pool.setup({
      instance: (id) =>
        Instance.define(() => ({
          endpoints: {
            metrics: {
              host: 'localhost',
              port: 9000 + id,
              protocol: 'http' as const,
            },
          },
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
      setup(instances, project) {
        expectTypeOf(
          instances[0]!.endpoints.metrics.protocol,
        ).toEqualTypeOf<'http'>()
        project.provide(
          'names',
          instances.map((instance) => instance.name),
        )
        project.provide(
          'urls',
          instances.map((instance) => instance.url),
        )
      },
    })

    const teardown = await setup(project)

    expect(started).toEqual([1, 2, 3])
    expect(context.get('names')).toEqual(['worker-1', 'worker-2', 'worker-3'])
    expect(context.get('urls')).toEqual([
      expect.stringMatching(/^http:\/\/localhost:\d+$/),
      expect.stringMatching(/^http:\/\/localhost:\d+$/),
      expect.stringMatching(/^http:\/\/localhost:\d+$/),
    ])
    await teardown()
    expect(stopped).toEqual([1, 2, 3])
  })

  test('destroys instances when setup fails', async () => {
    const stopped: number[] = []
    const setup = Pool.setup({
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
      setup() {
        throw new Error('setup failed')
      },
    })

    await expect(setup(testProject(2).project)).rejects.toThrowError(
      'setup failed',
    )

    expect(stopped).toEqual([1, 2])
  })

  test('destroys started instances when a start fails', async () => {
    const stopped: number[] = []
    const setup = Pool.setup({
      instance: (id) =>
        Instance.define(() => ({
          host: 'localhost',
          name: `worker-${id}`,
          port: 3000 + id,
          async start() {
            if (id === 2) throw new Error('start failed')
          },
          async stop() {
            stopped.push(id)
          },
        }))(),
      setup() {},
    })

    await expect(setup(testProject(3).project)).rejects.toThrowError(
      'start failed',
    )

    expect(stopped).toEqual([1, 3])
  })

  test('reports setup and teardown failures', async () => {
    const setup = Pool.setup({
      instance: Instance.define(() => ({
        host: 'localhost',
        name: 'worker',
        port: 3000,
        async start() {},
        async stop() {
          throw new Error('stop failed')
        },
      }))(),
      setup() {
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
    const setup = Pool.setup({
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
