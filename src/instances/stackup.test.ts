import getPort from 'get-port'
import { afterEach, beforeAll, expect, test } from 'vitest'

import { stackupOptions } from '../../test/utils.js'
import type { Instance } from '../instance.js'
import { anvil } from './anvil.js'
import { type StackupParameters, stackup } from './stackup.js'

const instances: Instance[] = []

const port = await getPort()

const defineInstance = (parameters?: Partial<StackupParameters>) => {
  const instance = stackup({
    ...stackupOptions({ port, pool: false }),
    ...parameters,
  })
  instances.push(instance)
  return instance
}

beforeAll(() => anvil({ port }).start())

afterEach(async () => {
  for (const instance of instances) await instance.stop().catch(() => {})
})

test('default', async () => {
  const messages: string[] = []
  const stdouts: string[] = []

  const instance = defineInstance()

  instance.on('message', (m) => messages.push(m))
  instance.on('stdout', (m) => stdouts.push(m))

  expect(instance.messages.get()).toMatchInlineSnapshot('[]')

  await instance.start()
  expect(instance.status).toEqual('started')

  expect(messages.join('')).toBeDefined()
  expect(stdouts.join('')).toBeDefined()
  expect(instance.messages.get().join('')).toBeDefined()

  await instance.stop()
  expect(instance.status).toEqual('stopped')

  expect(messages.join('')).toBeDefined()
  expect(stdouts.join('')).toBeDefined()
  expect(instance.messages.get()).toMatchInlineSnapshot('[]')
})

test('behavior: instance errored (duplicate ports)', async () => {
  const instance_1 = defineInstance({
    port: 1337,
  })
  const instance_2 = defineInstance({
    port: 1337,
  })

  await instance_1.start()
  await expect(() => instance_2.start()).rejects.toThrowError()
})

test('behavior: start and stop multiple times', async () => {
  const instance = defineInstance()

  await instance.start()
  await instance.stop()
  await instance.start()
  await instance.stop()
  await instance.start()
  await instance.stop()
  await instance.start()
  await instance.stop()
})

test('behavior: can subscribe to stderr', async () => {
  const messages: string[] = []

  const instance_1 = defineInstance({ port: 1337 })
  const instance_2 = defineInstance({ port: 1337 })

  await instance_1.start()
  instance_2.on('stderr', (message) => messages.push(message))
  await expect(instance_2.start()).rejects.toThrowError()
})

test('behavior: exit', async () => {
  const instance = defineInstance()

  let exitCode: number | null | undefined = undefined
  instance.on('exit', (code) => {
    exitCode = code
  })

  await instance.start()
  expect(instance.status).toEqual('started')

  instance._internal.process.kill()

  await new Promise<void>((res) => setTimeout(res, 100))
  expect(instance.status).toEqual('stopped')
  expect(typeof exitCode !== 'undefined').toBeTruthy()
})
