import { Pool } from 'prool'
import { Instance } from 'prool/testcontainers'
import { expect, expectTypeOf, test, vi } from 'vitest'

function environment(parameters: {
  down: () => Promise<unknown>
  host: string
  port: number
  services: (services: string[] | undefined) => void
}) {
  return {
    async up(services: string[] | undefined) {
      parameters.services(services)
      return {
        down: parameters.down,
        getContainer() {
          return {
            getHost: () => parameters.host,
            getMappedPort: () => parameters.port,
          }
        },
      }
    },
  }
}

test('pools compose environments with mapped endpoints', async () => {
  const downs: ReturnType<typeof vi.fn>[] = []
  const metrics = true as boolean
  const services: (string[] | undefined)[] = []
  let environments = 0
  const instance = Instance.compose({
    down: { removeVolumes: true },
    endpoints: {
      default: { container: 'api-1', port: 8080, protocol: 'http' },
      database: { container: 'database-1', port: 5432, protocol: 'tcp' },
      logs: undefined,
      metrics: metrics
        ? { container: 'metrics-1', port: 9090, protocol: 'ws' }
        : undefined,
    },
    environment() {
      environments++
      const down = vi.fn(async () => {})
      downs.push(down)
      return environment({
        down,
        host: '127.0.0.1',
        port: environments * 10_000,
        services: (value) => services.push(value),
      })
    },
    name: 'services',
    services: ['api', 'database'],
  })
  const pool = Pool.define({ instance })

  const [first, second] = await Promise.all([pool.start(1), pool.start(2)])

  expect(first.endpoints.default).toEqual({
    host: '127.0.0.1',
    port: expect.any(Number),
    protocol: 'http',
  })
  expect(second.endpoints.database).toEqual({
    host: '127.0.0.1',
    port: expect.any(Number),
    protocol: 'tcp',
  })
  expect(
    [first.endpoints.default.port, second.endpoints.database.port].sort(
      (a, b) => a - b,
    ),
  ).toEqual([10_000, 20_000])
  expectTypeOf(first.endpoints.default).toEqualTypeOf<
    Instance.Endpoint<'http'>
  >()
  expectTypeOf(first.endpoints.database).toEqualTypeOf<
    Instance.Endpoint<'tcp'>
  >()
  expectTypeOf(first.endpoints.logs).toEqualTypeOf<undefined>()
  expectTypeOf(first.endpoints.metrics).toEqualTypeOf<
    Instance.Endpoint<'ws'> | undefined
  >()
  expect(services).toEqual([
    ['api', 'database'],
    ['api', 'database'],
  ])

  await pool.restart(1)

  expect(first.endpoints.default.port).toBe(30_000)

  await pool.destroyAll()

  expect(downs).toHaveLength(3)
  for (const down of downs) {
    expect(down).toHaveBeenCalledOnce()
    expect(down).toHaveBeenCalledWith({ removeVolumes: true })
  }
})

test('tears down an environment when endpoint mapping fails', async () => {
  const down = vi.fn(async () => {})
  const instance = Instance.compose({
    endpoints: {
      default: { container: 'missing-1', port: 8080, protocol: 'http' },
    },
    environment: () => ({
      async up() {
        return {
          down,
          getContainer() {
            throw new Error('missing container')
          },
        }
      },
    }),
    name: 'services',
  })

  await expect(instance.start()).rejects.toThrow('missing container')
  expect(down).toHaveBeenCalledOnce()
  expect(instance.status).toBe('idle')
})

test('cleans a retained environment before retrying start', async () => {
  const retainedDown = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('down failed'))
    .mockResolvedValueOnce(undefined)
  const replacementDown = vi.fn(async () => {})
  let starts = 0
  const instance = Instance.compose({
    endpoints: {
      default: { container: 'api-1', port: 8080, protocol: 'http' },
    },
    environment: () => ({
      async up() {
        starts++
        if (starts === 1)
          return {
            down: retainedDown,
            getContainer() {
              throw new Error('missing container')
            },
          }
        return {
          down: replacementDown,
          getContainer() {
            return {
              getHost: () => '127.0.0.1',
              getMappedPort: (port: number) => port,
            }
          },
        }
      },
    }),
    name: 'services',
  })

  await expect(instance.start()).rejects.toThrow('missing container')
  await instance.start()

  expect(retainedDown).toHaveBeenCalledTimes(2)
  expect(instance.status).toBe('started')

  await instance.stop()
  expect(replacementDown).toHaveBeenCalledOnce()
})

test('retains the environment when stopping fails', async () => {
  const down = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('down failed'))
    .mockResolvedValueOnce(undefined)
  const instance = Instance.compose({
    endpoints: {
      default: { container: 'api-1', port: 8080, protocol: 'http' },
    },
    environment: () =>
      environment({
        down,
        host: '127.0.0.1',
        port: 8080,
        services: () => {},
      }),
    name: 'services',
  })

  await instance.start()
  await expect(instance.stop()).rejects.toThrow('down failed')
  expect(instance.status).toBe('started')

  await instance.stop()
  expect(down).toHaveBeenCalledTimes(2)
})

test('forwards a zero-second teardown grace period', async () => {
  const down = vi.fn(async () => {})
  const instance = Instance.compose({
    down: { timeout: 0 },
    endpoints: {
      default: { container: 'api-1', port: 8080, protocol: 'http' },
    },
    environment: () =>
      environment({
        down,
        host: '127.0.0.1',
        port: 8080,
        services: () => {},
      }),
    name: 'services',
  })

  await instance.start()
  await instance.stop()

  expect(down).toHaveBeenCalledWith({ timeout: 1 })
})
