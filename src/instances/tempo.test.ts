import * as os from 'node:os'
import getPort from 'get-port'
import { Instance } from 'prool'
import { afterEach, expect, test } from 'vitest'
import { type MessageEvent, WebSocket } from 'ws'
import { command } from './tempo.js'

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
  const instance_1 = defineInstance({ port: 8546 })
  const instance_2 = defineInstance({ port: 8546 })

  await instance_1.start()
  await expect(() => instance_2.start()).rejects.toThrowError('Failed to start')
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

test('behavior: can subscribe to stderr', async () => {
  const messages: string[] = []

  const instance_1 = defineInstance({ port: 8546 })
  const instance_2 = defineInstance({ port: 8546 })

  await instance_1.start()
  instance_2.on('stderr', (message) => messages.push(message))
  await expect(instance_2.start()).rejects.toThrow('Failed to start')
})

test(
  'behavior: faucet funds address',
  { timeout: slowTestTimeout },
  async () => {
    const instance = defineInstance()
    await instance.start()

    const rpc = async (method: string, params: unknown[]) => {
      const response = await fetch(`http://localhost:${port}`, {
        body: JSON.stringify({ id: 0, jsonrpc: '2.0', method, params }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      return await response.json()
    }

    // Funding races the first wall-clock block; expiring-nonce validation rejects until one exists.
    let json: { result?: string[] } = {}
    for (let i = 0; i < 50; i++) {
      json = await rpc('tempo_fundAddress', [
        '0x000000000000000000000000000000000000beef',
      ])
      if (json.result) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }

    expect(
      JSON.stringify(json).replaceAll(/0x[0-9a-f]{64}/g, '<hash>'),
    ).toMatchInlineSnapshot(
      `"{"jsonrpc":"2.0","id":0,"result":["<hash>","<hash>","<hash>","<hash>"]}"`,
    )

    // balanceOf(0x...beef) on the first faucet token.
    let balance = 0n
    for (let i = 0; i < 50; i++) {
      const { result } = await rpc('eth_call', [
        {
          data: '0x70a08231000000000000000000000000000000000000000000000000000000000000beef',
          to: '0x20c0000000000000000000000000000000000000',
        },
        'latest',
      ])
      balance = BigInt(result ?? 0)
      if (balance > 0n) break
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    expect(balance).toBeGreaterThan(0n)
  },
)

test(
  'behavior: serves websocket on http port',
  { timeout: slowTestTimeout },
  async () => {
    const instance = defineInstance()
    await instance.start()

    const ws = new WebSocket(`ws://localhost:${port}`)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve)
      ws.addEventListener('error', reject)
    })
    ws.send(JSON.stringify({ id: 0, jsonrpc: '2.0', method: 'eth_chainId' }))
    const { data } = await new Promise<MessageEvent>((resolve) =>
      ws.addEventListener('message', resolve),
    )
    ws.close()

    expect(JSON.parse(data.toString()).result).toBeDefined()
  },
)

const redact = (args: string[]) =>
  args.join(' ').replaceAll(os.tmpdir(), '<tmpdir>')

test('command: default', () => {
  expect(redact(command({ port: 8545 }))).toMatchInlineSnapshot(
    `"node --authrpc.port 8575 --datadir <tmpdir>/.prool/tempo.8545 --dev --dev.block-time 50ms --engine.disable-precompile-cache --engine.legacy-state-root --faucet.address 0x20c0000000000000000000000000000000000000 0x20c0000000000000000000000000000000000001 0x20c0000000000000000000000000000000000002 0x20c0000000000000000000000000000000000003 --faucet.amount 1000000000000 --faucet.enabled --faucet.private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --faucet.node-address http://localhost:8545 --http.addr 0.0.0.0 --http.api all --http.corsdomain * --http.port 8545 --port 8555 --ws --ws.addr 0.0.0.0 --ws.api all --ws.port 8545"`,
  )
})

test('command: behavior: faucet node address', () => {
  expect(
    redact(
      command({ faucet: { nodeAddress: 'http://localhost:1337' }, port: 8545 }),
    ),
  ).toMatchInlineSnapshot(
    `"node --authrpc.port 8575 --datadir <tmpdir>/.prool/tempo.8545 --dev --dev.block-time 50ms --engine.disable-precompile-cache --engine.legacy-state-root --faucet.address 0x20c0000000000000000000000000000000000000 0x20c0000000000000000000000000000000000001 0x20c0000000000000000000000000000000000002 0x20c0000000000000000000000000000000000003 --faucet.amount 1000000000000 --faucet.enabled --faucet.private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --faucet.node-address http://localhost:1337 --http.addr 0.0.0.0 --http.api all --http.corsdomain * --http.port 8545 --port 8555 --ws --ws.addr 0.0.0.0 --ws.api all --ws.port 8545"`,
  )
})

test('command: behavior: faucet disabled', () => {
  expect(
    redact(command({ faucet: { enabled: false }, port: 8545 })),
  ).toMatchInlineSnapshot(
    `"node --authrpc.port 8575 --datadir <tmpdir>/.prool/tempo.8545 --dev --dev.block-time 50ms --engine.disable-precompile-cache --engine.legacy-state-root --faucet.address 0x20c0000000000000000000000000000000000000 0x20c0000000000000000000000000000000000001 0x20c0000000000000000000000000000000000002 0x20c0000000000000000000000000000000000003 --faucet.amount 1000000000000 --faucet.enabled false --faucet.private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --http.addr 0.0.0.0 --http.api all --http.corsdomain * --http.port 8545 --port 8555 --ws --ws.addr 0.0.0.0 --ws.api all --ws.port 8545"`,
  )
})

test('command: behavior: ws port override', () => {
  expect(
    redact(command({ port: 8545, ws: [true, { port: 8565 }] })),
  ).toMatchInlineSnapshot(
    `"node --authrpc.port 8575 --datadir <tmpdir>/.prool/tempo.8545 --dev --dev.block-time 50ms --engine.disable-precompile-cache --engine.legacy-state-root --faucet.address 0x20c0000000000000000000000000000000000000 0x20c0000000000000000000000000000000000001 0x20c0000000000000000000000000000000000002 0x20c0000000000000000000000000000000000003 --faucet.amount 1000000000000 --faucet.enabled --faucet.private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --faucet.node-address http://localhost:8545 --http.addr 0.0.0.0 --http.api all --http.corsdomain * --http.port 8545 --port 8555 --ws --ws.port 8565"`,
  )
})

test('command: behavior: http port override', () => {
  expect(
    redact(command({ http: { port: 1337 }, port: 8545 })),
  ).toMatchInlineSnapshot(
    `"node --authrpc.port 8575 --datadir <tmpdir>/.prool/tempo.8545 --dev --dev.block-time 50ms --engine.disable-precompile-cache --engine.legacy-state-root --faucet.address 0x20c0000000000000000000000000000000000000 0x20c0000000000000000000000000000000000001 0x20c0000000000000000000000000000000000002 0x20c0000000000000000000000000000000000003 --faucet.amount 1000000000000 --faucet.enabled --faucet.private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --faucet.node-address http://localhost:1337 --http.addr 0.0.0.0 --http.api all --http.corsdomain * --http.port 1337 --port 8555 --ws --ws.addr 0.0.0.0 --ws.api all --ws.port 1337"`,
  )
})
