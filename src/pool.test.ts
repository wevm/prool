import getPort from 'get-port'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'

import { altoOptions, rundlerOptions, stackupOptions } from '../test/utils.js'
import { rundler } from './exports/instances.js'
import { alto } from './instances/alto.js'
import { anvil } from './instances/anvil.js'
import { stackup } from './instances/stackup.js'
import { definePool } from './pool.js'
import { createServer } from './server.js'

let pool: ReturnType<typeof definePool>
const port = await getPort()

beforeAll(() =>
  createServer({
    instance: anvil({
      chainId: 1,
      forkUrl: process.env.VITE_FORK_URL ?? 'https://eth.merkle.io',
    }),
    port,
  }).start(),
)

afterEach(async () => {
  try {
    await pool.stopAll()
  } catch (err) {
    console.error(err)
  }
})

describe.each([
  { instance: anvil({ port: await getPort() }) },
  {
    instance: alto(altoOptions({ port, pool: true })),
  },
  {
    instance: stackup(stackupOptions({ port, pool: true })),
  },
  {
    instance: rundler(rundlerOptions({ port, pool: true })),
  },
])('instance: $instance.name', ({ instance }) => {
  test('default', async () => {
    pool = definePool({
      instance,
    })

    expect(pool).toBeDefined()
  })

  test('start', async () => {
    pool = definePool({
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
    pool = definePool({
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
    pool = definePool({
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

  test(
    'restart',
    async () => {
      pool = definePool({
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
    },
    { timeout: 10_000 },
  )

  test('start > stop > start', async () => {
    pool = definePool({
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
    pool = definePool({
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
    pool = definePool({
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
    pool = definePool({
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
    pool = definePool({
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
    pool = definePool({
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
    pool = definePool({
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

    pool = definePool({
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
    pool = definePool({
      instance,
      limit: 2,
    })

    await pool.start(1)
    await pool.start(2)

    await expect(() => pool.start(3)).rejects.toThrowError(
      'Instance limit of 2 reached.',
    )
  })
})
