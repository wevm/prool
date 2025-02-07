import { afterEach, expect, test } from 'vitest'
import type { Instance } from '../instance.js'
import { type SupersimParameters, supersim } from './supersim.js'

const instances: Instance[] = []

const defineInstance = (parameters: SupersimParameters = {}) => {
  const instance = supersim(parameters)
  instances.push(instance)
  return instance
}

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

test('behavior: start supersim in forked mode', async () => {
  const messages: string[] = []

  const instance = defineInstance({
    fork: {
      chains: ['base', 'op'],
    },
  })

  instance.on('message', (m) => messages.push(m))

  await instance.start()

  expect(messages.join('')).toContain('chain.id=10')
  expect(messages.join('')).toContain('chain.id=8453')
})

test('behavior: start supersim with different ports', async () => {
  const instance = defineInstance({
    l1Port: 9000,
    l2StartingPort: 9001,
  })
  await instance.start()
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

test('behavior: exit when status is starting', async () => {
  const instance = defineInstance()

  const promise = instance.start()
  expect(instance.status).toEqual('starting')

  instance._internal.process.kill()

  await expect(promise).rejects.toThrowErrorMatchingInlineSnapshot(
    `[Error: Failed to start process "supersim": exited]`,
  )
})
