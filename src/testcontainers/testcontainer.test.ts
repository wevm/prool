import { Instance } from 'prool/testcontainers'
import type { TestContainer } from 'testcontainers'
import { expect, expectTypeOf, test, vi } from 'vitest'

type StartedContainer = {
  getHost(): string
  getMappedPort(port: number): number
  stop(): Promise<unknown>
}

function container(
  started: StartedContainer,
  expose: (ports: number[]) => void = () => {},
): TestContainer {
  const value = {
    async start() {
      return started
    },
    withExposedPorts(...ports: number[]) {
      expose(ports)
      return value
    },
  }
  return value as unknown as TestContainer
}

test('maps named endpoints and creates a fresh container on restart', async () => {
  const exposures: number[][] = []
  const stops: ReturnType<typeof vi.fn>[] = []
  const createContainer = vi.fn(() => {
    const start = createContainer.mock.calls.length
    const stop = vi.fn(async () => {})
    stops.push(stop)
    return container(
      {
        getHost: () => '127.0.0.1',
        getMappedPort: (port) => start * 10_000 + port,
        stop,
      },
      (ports) => exposures.push(ports),
    )
  })
  const instance = Instance.testcontainer({
    name: 'service',
    container: createContainer,
    endpoints: {
      default: { port: 8080, protocol: 'http' },
      metrics: { port: 9090, protocol: 'tcp' },
    },
  })

  expect(instance.endpoints.default).toEqual({
    host: 'localhost',
    port: 8080,
    protocol: 'http',
  })
  expect(instance.endpoints.metrics).toEqual({
    host: 'localhost',
    port: 9090,
    protocol: 'tcp',
  })
  expectTypeOf(instance.endpoints.default).toEqualTypeOf<
    Instance.Endpoint<'http'>
  >()
  expectTypeOf(instance.endpoints.metrics).toEqualTypeOf<
    Instance.Endpoint<'tcp'>
  >()

  await instance.start()

  expect(exposures).toEqual([[8080, 9090]])
  expect(instance.host).toBe('127.0.0.1')
  expect(instance.port).toBe(18_080)
  expect(instance.endpoints.metrics).toEqual({
    host: '127.0.0.1',
    port: 19_090,
    protocol: 'tcp',
  })

  await instance.restart()

  expect(createContainer).toHaveBeenCalledTimes(2)
  expect(exposures).toEqual([
    [8080, 9090],
    [8080, 9090],
  ])
  expect(stops[0]).toHaveBeenCalledOnce()
  expect(instance.port).toBe(28_080)

  await instance.stop()
  expect(stops[1]).toHaveBeenCalledOnce()
})

test('stops a container when endpoint mapping fails', async () => {
  const stop = vi.fn(async () => {})
  const instance = Instance.testcontainer({
    name: 'service',
    container: () =>
      container({
        getHost: () => '127.0.0.1',
        getMappedPort(port) {
          if (port === 9090) throw new Error('missing port')
          return port
        },
        stop,
      }),
    endpoints: {
      default: { port: 8080, protocol: 'http' },
      metrics: { port: 9090, protocol: 'http' },
    },
  })

  await expect(instance.start()).rejects.toThrow('missing port')
  expect(stop).toHaveBeenCalledOnce()
  expect(instance.status).toBe('idle')
})

test('cleans a retained container before retrying start', async () => {
  const retainedStop = vi
    .fn<StartedContainer['stop']>()
    .mockRejectedValueOnce(new Error('stop failed'))
    .mockResolvedValueOnce(undefined)
  const replacementStop = vi.fn(async () => {})
  let starts = 0
  const createContainer = vi.fn(() => {
    starts++
    if (starts === 1)
      return container({
        getHost: () => '127.0.0.1',
        getMappedPort(port) {
          if (port === 9090) throw new Error('missing port')
          return port
        },
        stop: retainedStop,
      })
    return container({
      getHost: () => '127.0.0.1',
      getMappedPort: (port) => port,
      stop: replacementStop,
    })
  })
  const instance = Instance.testcontainer({
    name: 'service',
    container: createContainer,
    endpoints: {
      default: { port: 8080, protocol: 'http' },
      metrics: { port: 9090, protocol: 'http' },
    },
  })

  await expect(instance.start()).rejects.toThrow('missing port')
  await instance.start()

  expect(createContainer).toHaveBeenCalledTimes(2)
  expect(retainedStop).toHaveBeenCalledTimes(2)
  expect(instance.status).toBe('started')

  await instance.stop()
  expect(replacementStop).toHaveBeenCalledOnce()
})

test('retains the container when stopping fails', async () => {
  const stop = vi
    .fn<StartedContainer['stop']>()
    .mockRejectedValueOnce(new Error('stop failed'))
    .mockResolvedValueOnce(undefined)
  const instance = Instance.testcontainer({
    name: 'service',
    container: () =>
      container({
        getHost: () => '127.0.0.1',
        getMappedPort: (port) => port,
        stop,
      }),
    endpoints: {
      default: { port: 8080, protocol: 'http' },
    },
  })

  await instance.start()
  await expect(instance.stop()).rejects.toThrow('stop failed')
  expect(instance.status).toBe('started')

  await instance.stop()
  expect(stop).toHaveBeenCalledTimes(2)
})
