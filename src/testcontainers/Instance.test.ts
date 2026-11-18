import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import getPort from 'get-port'
import { Instance, TempoId } from 'prool/testcontainers'
import { GenericContainer, PullPolicy } from 'testcontainers'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'

const instances: Instance.Instance[] = []
const slowTestTimeout = 120_000

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
  ).toMatchInlineSnapshot(`"{"jsonrpc":"2.0","id":0,"result":["<hash>"]}"`)

  // balanceOf(0x...beef) on the first faucet token and on OUSD.
  for (const token of [
    '0x20c0000000000000000000000000000000000000',
    '0x20c0000000000000000000006a37da5c996874be',
  ]) {
    let balance = 0n
    for (let i = 0; i < 100; i++) {
      const { result } = await rpc('eth_call', [
        {
          data: '0x70a08231000000000000000000000000000000000000000000000000000000000000beef',
          to: token,
        },
        'latest',
      ])
      balance = BigInt(result ?? 0)
      if (balance > 0n) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    expect(balance).toBeGreaterThan(0n)
  }
})

const zonePort = await getPort()
const zoneImage =
  'ghcr.io/tempoxyz/tempo-zone@sha256:dfc5e922c0ea9eebfa3345aa2ddb3df6f9070d20526348366f1746472a1959e2'

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

  test('named endpoints', { timeout: 600_000 }, async () => {
    const instance = defineZoneInstance({ image: zoneImage, log: 'warn' })

    await instance.start()
    expect(instance.status).toEqual('started')
    expect(instance.endpoints.default).toEqual({
      host: instance.host,
      port: instance.port,
      protocol: 'http',
    })
    expect(instance.endpoints.l1).toMatchObject({ protocol: 'ws' })

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
    expect(instance.endpoints.privateRpc).toEqual({
      ...privateRpc,
      protocol: 'http',
    })
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

test(
  'behavior: starts from a changed genesis',
  { timeout: slowTestTimeout },
  async () => {
    const instance = defineInstance({
      genesis: (genesis) => ({
        ...genesis,
        config: { ...genesis.config, chainId: 1338 },
      }),
    })
    await instance.start()
    const response = await fetch(instance.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
      }),
    })
    const { result, error } = await response.json()
    expect(error).toBeUndefined()
    expect(result).toBe('0x53a')
  },
)

test('behavior: selects hardfork', { timeout: slowTestTimeout }, async () => {
  const instance = defineInstance({ hardfork: 'T10' })
  await instance.start()
  const response = await fetch(instance.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tempo_forkSchedule',
      params: [],
    }),
  })
  const { result, error } = await response.json()
  expect(error).toBeUndefined()
  expect(result.active).toBe('T10')
})

describe('tempoId', () => {
  // Stands in for the private `id-dev` image: serves its health and code routes on `PORT`, and
  // echoes its environment.
  const image = 'prool-test/id-dev:local'
  const server = `
    const env = process.env
    require('node:http').createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost')
      if (url.pathname === '/__id-dev/health') return response.writeHead(204).end()
      if (url.pathname === '/__id-dev/code')
        return url.searchParams.get('email') === 'alice@example.org'
          ? response.end(JSON.stringify({ code: '123456' }))
          : response.writeHead(404).end()
      if (url.pathname === '/env') return response.end(JSON.stringify(env))
      response.writeHead(404).end()
    }).listen(Number(env.PORT), '0.0.0.0')
  `

  beforeAll(async () => {
    const context = fs.mkdtempSync(path.join(os.tmpdir(), 'prool-id-dev-'))
    fs.writeFileSync(path.join(context, 'server.js'), server)
    fs.writeFileSync(
      path.join(context, 'Dockerfile'),
      'FROM node:22-alpine\nCOPY server.js /server.js\nCMD ["node", "/server.js"]\n',
    )
    await GenericContainer.fromDockerfile(context).build(image, {
      deleteOnExit: false,
    })
  }, slowTestTimeout)

  test('serves on a fixed host port with apps and RPC URLs', async () => {
    const port = await getPort()
    const apps = [
      {
        clientId: 'prool-e2e',
        name: 'Prool',
        redirectUris: ['http://localhost:5173/callback'],
      },
    ]
    const instance = Instance.tempoId({
      apps,
      environment: { PORT: '1', SECRET: 'secret' },
      image,
      port,
      pullPolicy: PullPolicy.defaultPolicy(),
      resources: [{ identifier: 'https://api.example.org', name: 'API' }],
      rpcUrls: {
        local: { chainId: 1337, url: 'http://127.0.0.1:9545/1' },
        devnet: { chainId: 31318, url: 'https://rpc.example.org/' },
      },
    })
    instances.push(instance)
    await instance.start()

    expect(instance.url).toBe(`http://localhost:${port}`)
    const env = await fetch(`${instance.url}/env`).then((r) => r.json())
    expect({
      ID_DEV_APPS: JSON.parse(env.ID_DEV_APPS),
      ID_DEV_RESOURCES: JSON.parse(env.ID_DEV_RESOURCES),
      PORT: env.PORT,
      RPC_URLS: env.RPC_URLS,
      SECRET: env.SECRET,
    }).toEqual({
      ID_DEV_APPS: apps,
      ID_DEV_RESOURCES: [
        { identifier: 'https://api.example.org', name: 'API' },
      ],
      PORT: String(port),
      RPC_URLS:
        'local:1337=http://host.docker.internal:9545/1,devnet:31318=https://rpc.example.org',
      SECRET: 'secret',
    })
    expect(
      await TempoId.code({ email: 'alice@example.org', url: instance.url }),
    ).toBe('123456')
    expect(
      await TempoId.code({ email: 'bob@example.org', url: instance.url }),
    ).toBeUndefined()

    await instance.stop()
    await expect(fetch(instance.url)).rejects.toThrow()
  })

  test('checks an external instance without starting a container', async () => {
    const port = await getPort()
    const container = Instance.tempoId({
      image,
      port,
      pullPolicy: PullPolicy.defaultPolicy(),
    })
    instances.push(container)
    await container.start()

    const external = Instance.tempoId({
      image: 'prool-test/does-not-exist',
      url: `http://127.0.0.1:${port}/ignored`,
    })
    await external.start()
    expect(external.url).toBe(`http://127.0.0.1:${port}`)
    await external.stop()

    await container.stop()
    const unhealthy = Instance.tempoId({ url: `http://127.0.0.1:${port}` })
    await expect(unhealthy.start()).rejects.toThrowError(
      `Tempo ID at http://127.0.0.1:${port} failed its health check. Start an \`id-dev\` instance there, or unset \`url\`.`,
    )
  })
})
