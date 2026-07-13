import getPort from 'get-port'
import { Instance } from 'prool/testcontainers'
import { afterEach, describe, expect, test } from 'vitest'

const instances: Instance.Instance[] = []
const slowTestTimeout = 30_000

const port = await getPort()

const defineInstance = (parameters: Instance.tempo.Parameters = {}) => {
  const instance = Instance.tempo({ port, ...parameters })
  instances.push(instance)
  return instance
}

afterEach(async () => {
  for (const instance of instances) await instance.stop().catch(() => {})
})

test('default', { timeout: slowTestTimeout }, async () => {
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

test('behavior: instance errored (duplicate container names)', async () => {
  const containerName = `tempo.duplicate.${crypto.randomUUID()}`
  const instance_1 = defineInstance({ containerName, port: 8546 })
  const instance_2 = defineInstance({ containerName, port: 8547 })

  await instance_1.start()
  await expect(() => instance_2.start()).rejects.toThrowError()
})

test(
  'behavior: start and stop multiple times',
  { timeout: slowTestTimeout },
  async () => {
    const instance = defineInstance()

    await instance.start()
    await instance.stop()
    await instance.start()
    await instance.stop()
    await instance.start()
    await instance.stop()
    await instance.start()
    await instance.stop()
  },
)

test('behavior: can subscribe to stdout', async () => {
  const messages: string[] = []
  const instance = defineInstance()
  instance.on('stdout', (message) => messages.push(message))

  await instance.start()
  expect(messages.length).toBeGreaterThanOrEqual(1)
})

test.skip('behavior: can subscribe to stderr', () => {})

test('behavior: faucet funds address', { timeout: 120_000 }, async () => {
  const instance = defineInstance({ startupTimeout: 60_000 })
  await instance.start()

  const rpc = async (method: string, params: unknown[]) => {
    const response = await fetch(`http://${instance.host}:${instance.port}`, {
      body: JSON.stringify({ id: 0, jsonrpc: '2.0', method, params }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    return await response.json()
  }

  // Funding races the first wall-clock block; expiring-nonce validation rejects until one exists.
  let json: { result?: string[] } = {}
  for (let i = 0; i < 100; i++) {
    json = await rpc('tempo_fundAddress', [
      '0x000000000000000000000000000000000000beef',
    ])
    if (json.result) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  expect(
    JSON.stringify(json).replaceAll(/0x[0-9a-f]{64}/g, '<hash>'),
  ).toMatchInlineSnapshot(
    `"{"jsonrpc":"2.0","id":0,"result":["<hash>","<hash>","<hash>","<hash>"]}"`,
  )

  // balanceOf(0x...beef) on the first faucet token.
  let balance = 0n
  for (let i = 0; i < 100; i++) {
    const { result } = await rpc('eth_call', [
      {
        data: '0x70a08231000000000000000000000000000000000000000000000000000000000000beef',
        to: '0x20c0000000000000000000000000000000000000',
      },
      'latest',
    ])
    balance = BigInt(result ?? 0)
    if (balance > 0n) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  expect(balance).toBeGreaterThan(0n)
})

const zonePort = await getPort()

describe('tempoZone', () => {
  const defineZoneInstance = (
    parameters: Instance.tempoZone.Parameters = {},
  ) => {
    const instance = Instance.tempoZone({
      port: zonePort,
      ...parameters,
    })
    instances.push(instance)
    return instance
  }

  test('default image with quiet logs', { timeout: 600_000 }, async () => {
    const instance = defineZoneInstance({ log: 'warn' })

    await instance.start()
    expect(instance.status).toEqual('started')

    const rpc = async (method: string, params: unknown[]) => {
      const response = await fetch(`http://${instance.host}:${instance.port}`, {
        body: JSON.stringify({ id: 0, jsonrpc: '2.0', method, params }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      return await response.json()
    }

    // Zone chain IDs are derived: ZONE_CHAIN_ID_BASE + (zone_id % range).
    const { result: chainId } = await rpc('eth_chainId', [])
    expect(BigInt(chainId)).toBeGreaterThanOrEqual(421_700_000n)

    const { result: blockNumber } = await rpc('eth_blockNumber', [])
    expect(blockNumber).toBeDefined()

    const { result: pathUsdCode } = await rpc('eth_getCode', [
      '0x20c0000000000000000000000000000000000000',
      'latest',
    ])
    expect(pathUsdCode).toMatch(/^0x[0-9a-f]{2,}$/)

    // Private RPC rejects unauthenticated requests after becoming reachable.
    const { privateRpc } = instance._internal
    expect(privateRpc).toBeDefined()
    const response = await fetch(
      `http://${privateRpc!.host}:${privateRpc!.port}`,
      {
        body: JSON.stringify({
          id: 0,
          jsonrpc: '2.0',
          method: 'zone_getZoneInfo',
          params: [],
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    )
    expect(response.status).toBe(401)

    await instance.stop()
    expect(instance.status).toEqual('stopped')
  })
})
