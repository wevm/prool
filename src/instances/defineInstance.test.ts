import { expect, test } from 'vitest'
import { defineInstance } from './defineInstance.js'

test('default', async () => {
  let started = false
  const foo = defineInstance(() => {
    return {
      name: 'foo',
      host: 'localhost',
      port: 3000,
      async start() {
        started = true
      },
      async stop() {
        started = false
      },
    }
  })

  const instance = foo()

  expect(started).toEqual(false)
  await instance.start()
  expect(started).toEqual(true)
  await instance.stop()
  expect(started).toEqual(false)
})

test('behavior: parameters', async () => {
  let started = [false, {}]
  const foo = defineInstance((parameters: { bar: string }) => {
    return {
      name: 'foo',
      host: 'localhost',
      port: 3000,
      async start() {
        started = [true, parameters]
      },
      async stop() {
        started = [false, {}]
      },
    }
  })

  const instance = foo({ bar: 'baz' })

  expect(started).toEqual([false, {}])
  await instance.start()
  expect(started).toEqual([true, { bar: 'baz' }])
  await instance.stop()
  expect(started).toEqual([false, {}])
})

test('behavior: start', async () => {
  let count = 0
  const foo = defineInstance(() => {
    return {
      name: 'foo',
      host: 'localhost',
      port: 3000,
      async start() {
        count++
      },
      async stop() {},
    }
  })

  const instance = foo()

  expect(instance.status).toEqual('idle')

  const promise_1 = instance.start()
  expect(instance.status).toEqual('starting')

  const promise_2 = instance.start()
  expect(instance.status).toEqual('starting')

  expect(promise_1).toStrictEqual(promise_2)
  expect(count).toEqual(1)

  await promise_1

  expect(instance.status).toEqual('started')

  instance.stop()
  expect(instance.status).toEqual('stopping')

  expect(() => instance.start()).rejects.toThrowErrorMatchingInlineSnapshot(
    `[Error: Instance "foo" is not in an idle or stopped state.]`,
  )
})

test('behavior: stop', async () => {
  let count = 0
  const foo = defineInstance(() => {
    return {
      name: 'foo',
      host: 'localhost',
      port: 3000,
      async start() {},
      async stop() {
        count++
      },
    }
  })

  const instance = foo()
  await instance.start()

  const promise_1 = instance.stop()
  expect(instance.status).toEqual('stopping')
  const promise_2 = instance.stop()
  expect(instance.status).toEqual('stopping')

  expect(promise_1).toStrictEqual(promise_2)
  expect(count).toEqual(1)

  await promise_1

  expect(instance.status).toEqual('stopped')

  instance.start()
  expect(instance.status).toEqual('starting')

  expect(() => instance.stop()).rejects.toThrowErrorMatchingInlineSnapshot(
    `[Error: Instance "foo" has not started.]`,
  )
})

test('options: timeout', async () => {
  const foo = defineInstance(() => {
    return {
      name: 'foo',
      host: 'localhost',
      port: 3000,
      async start() {
        await new Promise((resolve) => setTimeout(resolve, 200))
      },
      async stop() {},
    }
  })

  const instance_1 = foo({ timeout: 100 })
  await expect(() => instance_1.start()).rejects.toThrow(
    'Instance "foo" failed to start in time',
  )

  const bar = defineInstance(() => {
    return {
      name: 'bar',
      host: 'localhost',
      port: 3000,
      async start() {},
      async stop() {
        await new Promise((resolve) => setTimeout(resolve, 200))
      },
    }
  })

  const instance_2 = bar({ timeout: 100 })
  await instance_2.start()
  await expect(() => instance_2.stop()).rejects.toThrow(
    'Instance "bar" failed to stop in time',
  )
})

test('behavior: events', async () => {
  const foo = defineInstance(() => {
    return {
      name: 'foo',
      host: 'localhost',
      port: 3000,
      async start({ emitter }) {
        emitter.emit('message', 'hello')
      },
      async stop() {
        emitter.emit('message', 'goodbye')
      },
    }
  })

  const instance = foo()
})
