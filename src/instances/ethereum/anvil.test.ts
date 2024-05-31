import { afterEach, expect, test } from 'vitest'
import type { Instance } from '../defineInstance.js'
import { type AnvilParameters, anvil } from './anvil.js'

const instances: Instance[] = []
const timestamp = 1717114065

const defineInstance = (parameters: AnvilParameters = {}) => {
  const instance = anvil(parameters)
  instances.push(instance)
  return instance
}

afterEach(async () => {
  for (const instance of instances) await instance.stop().catch(() => {})
})

test('default', async () => {
  const messages: string[] = []
  const stdouts: string[] = []

  const instance = defineInstance({ timestamp })

  instance.on('message', (m) => messages.push(m))
  instance.on('stdout', (m) => stdouts.push(m))

  expect(instance.messages.get()).toMatchInlineSnapshot('[]')

  await instance.start()
  expect(instance.status).toEqual('started')

  expect(messages.join('')).toMatchSnapshot()
  expect(stdouts.join('')).toMatchSnapshot()
  expect(instance.messages.get().join('')).toMatchSnapshot()

  await instance.stop()
  expect(instance.status).toEqual('stopped')

  expect(messages.join('')).toMatchSnapshot()
  expect(stdouts.join('')).toMatchSnapshot()
  expect(instance.messages.get()).toMatchInlineSnapshot('[]')
})

test('behavior: instance errored (duplicate ports)', async () => {
  const instance_1 = defineInstance({ timestamp, port: 8545 })
  const instance_2 = defineInstance({ timestamp, port: 8545 })

  await instance_1.start()
  await expect(() => instance_2.start()).rejects.toThrowError(
    'Failed to start anvil',
  )
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

test('behavior: can subscribe to stdout', async () => {
  const messages: string[] = []
  const instance = defineInstance({ timestamp })
  instance.on('stdout', (message) => messages.push(message))

  await instance.start()
  expect(messages.length).toBeGreaterThanOrEqual(1)
})

test('behavior: can subscribe to stderr', async () => {
  const messages: string[] = []

  const instance_1 = defineInstance({ timestamp, port: 8545 })
  const instance_2 = defineInstance({ timestamp, port: 8545 })

  await instance_1.start()
  instance_2.on('stderr', (message) => messages.push(message))
  await expect(instance_2.start()).rejects.toThrow('Failed to start anvil')

  expect(messages.length).toBeGreaterThanOrEqual(1)
  expect(messages.join('')).toContain(
    'Error: Address already in use (os error 48)',
  )
})

test('behavior: starts anvil with custom options', async () => {
  const instance = defineInstance({
    timestamp,
    chainId: 123,
    forkBlockNumber: 69420,
    forkUrl: 'https://cloudflare-eth.com',
  })

  await instance.start()
})
