import getPort from 'get-port'
import { Instance, Pool, Server } from 'prool'
import {
  afterAll,
  afterEach,
  describe,
  expect,
  expectTypeOf,
  test,
  vi,
} from 'vitest'

import { altoOptions } from '../test/utils.js'

let pool: ReturnType<typeof Pool.define> | undefined
const executionServer = Server.create({
  instance: Instance.anvil({
    chainId: 1,
    forkUrl:
      process.env['VITE_FORK_URL'] ?? 'https://ethereum-rpc.publicnode.com',
  }),
})
const stopExecutionServer = await executionServer.start()
const port = executionServer.address()!.port

afterAll(stopExecutionServer)

afterEach(async () => {
  try {
    await pool?.stopAll()
  } catch (err) {
    console.error(err)
  }
})

test('preserves named endpoint types', async () => {
  const foo = Instance.define(() => ({
    endpoints: {
      metrics: {
        host: 'localhost',
        port: 9090,
        protocol: 'http' as const,
      },
    },
    host: 'localhost',
    name: 'foo',
    port: 3000,
    async start() {},
    async stop() {},
  }))
  const namedPool = Pool.define({ instance: foo() })

  const instance = await namedPool.start(1)

  expect(instance.endpoints.metrics).toEqual({
    host: 'localhost',
    port: 9090,
    protocol: 'http',
  })
  expectTypeOf(instance.endpoints.metrics.protocol).toEqualTypeOf<'http'>()
  await namedPool.destroyAll()
})

test('enforces the instance limit across concurrent starts', async () => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const instance = Instance.define(() => ({
    host: 'localhost',
    name: 'foo',
    port: 3000,
    async start() {
      started.resolve()
      await release.promise
    },
    async stop() {},
  }))()
  const limitedPool = Pool.define({ instance, limit: 1 })

  const first = limitedPool.start(1)
  await started.promise
  const limited = expect(limitedPool.start(2)).rejects.toThrowError(
    'Instance limit of 1 reached.',
  )

  release.resolve()
  await limited
  await first
  await limitedPool.destroyAll()
})

describe('create', () => {
  function instance(
    parameters: {
      start?: ((id: number) => void) | undefined
      stop?: ((id: number) => void) | undefined
    } = {},
  ) {
    let id = 0
    return Instance.define(() => {
      const value = ++id
      return {
        endpoints: {
          metrics: {
            host: 'localhost',
            port: 9000 + value,
            protocol: 'http' as const,
          },
        },
        host: 'localhost',
        name: 'foo',
        port: 3000 + value,
        async start() {
          parameters.start?.(value)
        },
        async stop() {
          parameters.stop?.(value)
        },
      }
    })()
  }

  test('leases and reuses instances', async () => {
    const starts: number[] = []
    const leasePool = Pool.create({
      instance: instance({ start: (id) => starts.push(id) }),
      limit: 1,
    })

    const first = await leasePool.acquire()
    const waiting = leasePool.acquire()
    let acquired = false
    waiting.then(() => {
      acquired = true
    })
    await Promise.resolve()

    expect(acquired).toBe(false)
    expectTypeOf(
      first.instance.endpoints.metrics.protocol,
    ).toEqualTypeOf<'http'>()

    await first.release()
    const second = await waiting

    expect(second.instance).toBe(first.instance)
    expect(starts).toHaveLength(1)

    await second.release()
    await leasePool.close()
  })

  test('serves waiters in order after resetting', async () => {
    const reset = vi.fn(async () => {})
    const leasePool = Pool.create({ instance: instance(), limit: 1, reset })
    const first = await leasePool.acquire()
    const order: number[] = []
    const second = leasePool.acquire().then((lease) => {
      order.push(2)
      return lease
    })
    const third = leasePool.acquire().then((lease) => {
      order.push(3)
      return lease
    })

    await first.release()
    const lease_2 = await second
    expect(reset).toHaveBeenCalledWith(first.instance)
    expect(order).toEqual([2])

    await lease_2.release()
    const lease_3 = await third
    expect(order).toEqual([2, 3])

    await lease_3.release()
    await leasePool.close()
  })

  test('replaces an instance when reset fails', async () => {
    const stops: number[] = []
    const reset = vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error('reset failed'))
      .mockRejectedValueOnce(new Error('reset failed again'))
    const leasePool = Pool.create({
      instance: instance({ stop: (id) => stops.push(id) }),
      limit: 1,
      reset,
    })
    const first = await leasePool.acquire()

    await expect(first.release()).rejects.toThrowError('reset failed')
    const second = await leasePool.acquire()

    expect(second.instance).not.toBe(first.instance)
    expect(stops).toHaveLength(1)

    await expect(second.release()).rejects.toThrowError('reset failed again')
    const third = await leasePool.acquire()
    expect(third.instance).not.toBe(second.instance)
    expect(stops).toHaveLength(2)

    await third.release()
    await leasePool.close()
  })

  test('releases a limit reservation after setup fails', async () => {
    let creates = 0
    const source = Instance.define(() => {
      creates++
      if (creates === 2) throw new Error('create failed')
      return {
        host: 'localhost',
        name: 'foo',
        port: 3000,
        async start() {},
        async stop() {},
      }
    })()
    const limitedPool = Pool.define({ instance: source, limit: 1 })

    await expect(limitedPool.start(1)).rejects.toThrowError('create failed')
    await expect(limitedPool.start(2)).resolves.toBeDefined()

    await limitedPool.destroyAll()
  })

  test('closes pending acquisitions', async () => {
    const leasePool = Pool.create({ instance: instance(), limit: 1 })
    const lease = await leasePool.acquire()
    const waiting = leasePool.acquire()

    await leasePool.close()

    await expect(waiting).rejects.toThrowError('Pool is closed.')
    await expect(leasePool.acquire()).rejects.toThrowError('Pool is closed.')
    await lease.release()
  })

  test('requires a positive integer limit', () => {
    expect(() => Pool.create({ instance: instance(), limit: 0 })).toThrowError(
      'Pool limit must be a positive integer.',
    )
  })
})

describe.each([
  { instance: Instance.anvil({ port: await getPort() }) },
  { instance: Instance.tempo({ port: await getPort() }) },
  {
    instance: Instance.alto(altoOptions({ port, pool: true })),
  },
])('instance: $instance.name', ({ instance }) => {
  test('default', async () => {
    pool = Pool.define({
      instance,
    })

    expect(pool).toBeDefined()
  })

  test('start', async () => {
    pool = Pool.define({
      instance,
    })

    expect(pool.size).toEqual(0)

    const instance_1 = await pool.start(1)
    expect(instance_1.status).toBe('started')
    expect(pool.size).toEqual(1)

    const instance_2 = await pool.start(2)
    expect(instance_2.status).toBe('started')
    expect(pool.size).toEqual(2)

    const instance_3 = await pool.start(1337)
    expect(instance_3.status).toBe('started')
    expect(pool.size).toEqual(3)
  })

  test('callback instance', async () => {
    const keys: (number | string)[] = []
    pool = Pool.define({
      instance(key) {
        keys.push(key)
        return instance
      },
    })

    await pool.start(1)
    await pool.start(2)
    await pool.start(1337)

    expect(keys).toStrictEqual([1, 2, 1337])
  })

  test('stop / destroy', async () => {
    pool = Pool.define({
      instance,
    })

    const instance_1 = await pool.start(1)
    const instance_2 = await pool.start(2)
    const instance_3 = await pool.start(3)

    expect(instance_1.status).toBe('started')
    expect(instance_2.status).toBe('started')
    expect(instance_3.status).toBe('started')
    expect(pool.size).toEqual(3)

    await pool.stop(1)
    expect(instance_1.status).toBe('stopped')

    await pool.stop(2)
    expect(instance_2.status).toBe('stopped')

    await pool.stop(3)
    expect(instance_3.status).toBe('stopped')

    await pool.stop(1)
    await pool.stop(2)
    await pool.stop(3)
    await pool.stop(4)

    expect(pool.size).toEqual(3)

    await pool.destroy(1)
    expect(pool.size).toEqual(2)
    await pool.destroy(2)
    expect(pool.size).toEqual(1)
    await pool.destroy(3)
    expect(pool.size).toEqual(0)
  })

  test('restart', { timeout: 10_000 }, async () => {
    pool = Pool.define({
      instance,
    })

    const instance_1 = await pool.start(1)
    const instance_2 = await pool.start(2)
    const instance_3 = await pool.start(3)

    expect(instance_1.status).toBe('started')
    expect(instance_2.status).toBe('started')
    expect(instance_3.status).toBe('started')
    expect(pool.size).toEqual(3)

    const promise_1 = pool.restart(1)
    expect(instance_1.status).toBe('restarting')
    await promise_1
    expect(instance_1.status).toBe('started')
  })

  test('start > stop > start', async () => {
    pool = Pool.define({
      instance,
    })

    const instance_1 = await pool.start(1)
    expect(instance_1.status).toBe('started')

    await pool.stop(1)
    expect(instance_1.status).toBe('stopped')

    await pool.start(1)
    expect(instance_1.status).toBe('started')
  })

  test('stopAll / destroyAll', async () => {
    pool = Pool.define({
      instance,
    })

    await pool.start(1)
    await pool.start(2)
    await pool.start(3)

    expect(pool.size).toEqual(3)

    await pool.stopAll()
    expect(pool.size).toEqual(3)

    await pool.destroyAll()
    expect(pool.size).toEqual(0)
  })

  test('get', async () => {
    pool = Pool.define({
      instance,
    })

    const instance_1 = await pool.start(1)
    const instance_2 = await pool.start(2)
    const instance_3 = await pool.start(3)

    expect(pool.get(1)).toStrictEqual(instance_1)
    expect(pool.get(2)).toStrictEqual(instance_2)
    expect(pool.get(3)).toStrictEqual(instance_3)
  })

  test('behavior: start more than once', async () => {
    pool = Pool.define({
      instance,
    })

    const promise_1 = pool.start(1)
    const promise_2 = pool.start(1)
    expect(promise_1).toStrictEqual(promise_2)

    const instance_1 = await promise_1
    const instance_2 = await promise_2
    expect(instance_1).toStrictEqual(instance_2)
  })

  test('behavior: clear more than once', async () => {
    pool = Pool.define({
      instance,
    })

    await pool.start(1)
    await pool.start(2)
    await pool.start(3)

    const promise_1 = pool.stopAll()
    const promise_2 = pool.stopAll()
    expect(promise_1).toStrictEqual(promise_2)

    await promise_1
    await promise_2
  })

  test('behavior: restart more than once', async () => {
    pool = Pool.define({
      instance,
    })

    const instance_1 = await pool.start(1)
    expect(instance_1.status).toBe('started')

    const promise_1 = pool.restart(1)
    expect(instance_1.status).toBe('restarting')
    const promise_2 = pool.restart(1)
    expect(instance_1.status).toBe('restarting')

    expect(promise_1).toStrictEqual(promise_2)

    await promise_1
    expect(instance_1.status).toBe('started')
    await promise_2
    expect(instance_1.status).toBe('started')
  })

  test('behavior: stop more than once', async () => {
    pool = Pool.define({
      instance,
    })

    await pool.start(1)

    const promise_1 = pool.stop(1)
    const promise_2 = pool.stop(1)
    expect(promise_1).toStrictEqual(promise_2)

    await promise_1
    await promise_2
  })

  test('error: start more than once on same port', async () => {
    const port = await getPort()

    pool = Pool.define({
      instance,
    })

    await pool.start(1, { port })

    const promise_1 = pool.start(2, { port })
    const promise_2 = pool.start(2, { port })
    expect(promise_1).toStrictEqual(promise_2)

    await expect(() => promise_1).rejects.toThrowError()
    await expect(() => promise_2).rejects.toThrowError()
  })

  test('error: instance limit reached', async () => {
    pool = Pool.define({
      instance,
      limit: 2,
    })

    await pool.start(1)
    await pool.start(2)

    await expect(() => pool!.start(3)).rejects.toThrowError(
      'Instance limit of 2 reached.',
    )
  })
})
