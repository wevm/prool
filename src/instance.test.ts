import { expect, test } from 'vitest'
import { defineInstance } from './instance.js'

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
    `[Error: Instance "foo" is not in an idle or stopped state. Status: stopping]`,
  )
})

test('behavior: start (error)', async () => {
  const foo = defineInstance(() => {
    return {
      name: 'foo',
      host: 'localhost',
      port: 3000,
      async start() {
        throw new Error('oh no')
      },
      async stop() {},
    }
  })

  const instance = foo()

  expect(instance.status).toEqual('idle')
  await expect(instance.start()).rejects.toThrowErrorMatchingInlineSnapshot(
    '[Error: oh no]',
  )
  expect(instance.status).toEqual('idle')
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
    `[Error: Instance "foo" is starting.]`,
  )
})

test('behavior: stop (error)', async () => {
  const foo = defineInstance(() => {
    return {
      name: 'foo',
      host: 'localhost',
      port: 3000,
      async start() {},
      async stop() {
        throw new Error('oh no')
      },
    }
  })

  const instance = foo()

  await instance.start()
  expect(instance.status).toEqual('started')

  await expect(instance.stop()).rejects.toThrowErrorMatchingInlineSnapshot(
    '[Error: oh no]',
  )
  expect(instance.status).toEqual('started')
})

test('behavior: restart', async () => {
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
  await instance.start()

  expect(instance.status).toEqual('started')
  const promise_1 = instance.restart()
  expect(instance.status).toEqual('restarting')
  const promise_2 = instance.restart()
  expect(instance.status).toEqual('restarting')

  expect(promise_1).toStrictEqual(promise_2)

  await promise_1
  await promise_2

  expect(instance.status).toEqual('started')
  expect(count).toEqual(2)
})

test('behavior: events', async () => {
  const foo = defineInstance(() => {
    let count = 0
    return {
      name: 'foo',
      host: 'localhost',
      port: 3000,
      async start(_, { emitter }) {
        emitter.emit('message', count.toString())
        emitter.emit('listening')
        if (count > 0) emitter.emit('stderr', 'stderr')
        else emitter.emit('stdout', 'stdout')
        count++
      },
      async stop({ emitter }) {
        emitter.emit('exit', 0, 'SIGTERM')
        emitter.emit('message', 'goodbye')
      },
    }
  })

  const listening = Promise.withResolvers<void>()
  const message_1 = Promise.withResolvers<string>()
  const stdout = Promise.withResolvers<string>()
  const stderr = Promise.withResolvers<string>()
  const exit = Promise.withResolvers<unknown>()

  const instance = foo()
  instance.once('listening', listening.resolve)
  instance.once('message', message_1.resolve)
  instance.once('stdout', stdout.resolve)
  instance.once('stderr', stderr.resolve)
  instance.once('exit', exit.resolve)

  await instance.start()

  await listening.promise
  expect(await message_1.promise).toEqual('0')
  expect(await stdout.promise).toEqual('stdout')

  const message_2 = Promise.withResolvers()
  instance.once('message', message_2.resolve)

  await instance.stop()

  expect(await message_2.promise).toEqual('goodbye')
  await exit.promise

  const message_3 = Promise.withResolvers()
  instance.once('message', message_3.resolve)

  await instance.start()

  expect(await message_3.promise).toEqual('1')
  expect(await stderr.promise).toEqual('stderr')
})

test('behavior: messages', async () => {
  const foo = defineInstance(() => {
    return {
      name: 'foo',
      host: 'localhost',
      port: 3000,
      async start(_, { emitter }) {
        for (let i = 0; i < 50; i++) emitter.emit('message', i.toString())
      },
      async stop() {},
    }
  })

  const instance = foo()
  expect(instance.messages.get()).toEqual([])

  await instance.start()
  expect(instance.messages.get()).toMatchInlineSnapshot(`
    [
      "30",
      "31",
      "32",
      "33",
      "34",
      "35",
      "36",
      "37",
      "38",
      "39",
      "40",
      "41",
      "42",
      "43",
      "44",
      "45",
      "46",
      "47",
      "48",
      "49",
    ]
  `)
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
