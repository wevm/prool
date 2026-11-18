import { createServer, request } from 'node:http'
import getPort from 'get-port'
import { Instance, Pool, Server } from 'prool'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { type MessageEvent, WebSocket } from 'ws'
import { altoOptions } from '../test/utils.js'

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

test('request: lifecycle endpoint discovery', async () => {
  const foo = Instance.define(() => {
    let starts = 0
    return {
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
      async start(_, { setEndpoint }) {
        starts++
        setEndpoint?.('metrics', {
          host: '127.0.0.1',
          port: 9090 + starts,
          protocol: 'http',
        })
      },
      async stop() {},
    }
  })
  const server = Server.create({ instance: foo() })
  const stop = await server.start()
  const { port } = server.address()!

  const start = await fetch(`http://localhost:${port}/1/start`).then(
    (response) => response.json(),
  )
  expect(start).toMatchObject({
    endpoints: {
      default: { protocol: 'http' },
      metrics: {
        host: '127.0.0.1',
        port: 9091,
        protocol: 'http',
      },
    },
  })
  expect(start).toMatchObject({
    host: start.endpoints.default.host,
    port: start.endpoints.default.port,
    url: `http://${start.endpoints.default.host}:${start.endpoints.default.port}`,
  })

  const restart = await fetch(`http://localhost:${port}/1/restart`).then(
    (response) => response.json(),
  )
  expect(restart.endpoints.metrics.port).toBe(9092)

  await stop()
})

test('request: leases pooled instances', async () => {
  let instances = 0
  const reset = vi.fn(async () => {})
  const foo = Instance.define(() => {
    const id = ++instances
    return {
      endpoints: {
        database: {
          host: 'localhost',
          port: 5432,
          protocol: 'tcp' as const,
        },
      },
      host: 'localhost',
      name: 'foo',
      port: 3000,
      async start(_, { setEndpoint }) {
        setEndpoint?.({ host: '127.0.0.1', port: 3000 + id })
      },
      async stop() {},
    }
  })
  const pool = Pool.create({ instance: foo(), limit: 1, reset })
  const server = Server.create({ host: '127.0.0.1', pool, port: 0 })
  const stop = await server.start()
  expect(server.address()!.address).toBe('127.0.0.1')
  const url = `http://localhost:${server.address()!.port}`

  const first = await fetch(`${url}/acquire`, { method: 'POST' }).then(
    (response) => response.json(),
  )
  expect(first).toMatchObject({
    endpoints: {
      database: { port: 5432, protocol: 'tcp' },
      default: { host: '127.0.0.1', protocol: 'http' },
    },
    host: '127.0.0.1',
    token: expect.any(String),
    url: `http://127.0.0.1:${first.port}`,
  })

  const waiting = fetch(`${url}/acquire`, { method: 'POST' })
  expect(
    await Promise.race([
      waiting.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20)),
    ]),
  ).toBe(false)

  const released = await fetch(`${url}/release/${first.token}`, {
    method: 'POST',
  })
  expect(released.status).toBe(204)

  const second = await waiting.then((response) => response.json())
  expect(second.port).toBe(first.port)
  expect(second.token).not.toBe(first.token)
  expect(reset).toHaveBeenCalledOnce()

  expect(
    (
      await fetch(`${url}/release/${second.token}`, {
        method: 'POST',
      })
    ).status,
  ).toBe(204)
  expect(
    (
      await fetch(`${url}/release/${second.token}`, {
        method: 'POST',
      })
    ).status,
  ).toBe(404)

  await stop()
})

test('request: releases a lease when acquisition disconnects', async () => {
  const reset = vi.fn(async () => {})
  const foo = Instance.define(() => ({
    host: 'localhost',
    name: 'foo',
    port: 3000,
    async start() {},
    async stop() {},
  }))
  const pool = Pool.create({ instance: foo(), limit: 1, reset })
  const first = await pool.acquire()
  const acquire = vi.spyOn(pool, 'acquire')
  const server = Server.create({ pool })
  const stop = await server.start()
  const url = `http://localhost:${server.address()!.port}`
  const request_ = request(`${url}/acquire`, { method: 'POST' })
  const disconnected = new Promise<void>((resolve) => {
    request_.once('error', () => resolve())
  })
  request_.end()

  await vi.waitFor(() => expect(acquire).toHaveBeenCalledOnce())
  request_.destroy(new Error('disconnected'))
  await disconnected
  await new Promise((resolve) => setTimeout(resolve, 20))
  await first.release()
  await vi.waitFor(() => expect(reset).toHaveBeenCalledTimes(2))

  const next = await pool.acquire()
  await next.release()
  await stop()
})

test('request: reports lease pool teardown failures', async () => {
  const foo = Instance.define(() => ({
    host: 'localhost',
    name: 'foo',
    port: 3000,
    async start() {},
    async stop() {
      throw new Error('stop failed')
    },
  }))
  const pool = Pool.create({ instance: foo(), limit: 1 })
  await pool.acquire()
  const server = Server.create({ pool })
  await server.start()

  await expect(server.stop()).rejects.toThrowError('stop failed')
})

test('request: rejects a TCP default proxy', async () => {
  const database = Instance.define(() => ({
    endpoints: {
      default: {
        host: 'localhost',
        port: 5432,
        protocol: 'tcp' as const,
      },
    },
    host: 'localhost',
    name: 'database',
    port: 5432,
    async start() {},
    async stop() {},
  }))
  const server = Server.create({ instance: database() })
  const stop = await server.start()
  const { port } = server.address()!

  const response = await fetch(`http://localhost:${port}/1`)

  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({
    message: 'Cannot proxy tcp endpoint over HTTP.',
  })

  await stop()
})

describe.each([
  { instance: Instance.anvil({ port: await getPort() }) },
  { instance: Instance.tempo({ port: await getPort() }) },
  {
    instance: Instance.alto(altoOptions({ port, pool: true })),
  },
])('instance: $instance.name', ({ instance }) => {
  test('default', async () => {
    const server = Server.create({
      instance,
    })
    expect(server).toBeDefined()

    await server.start()
    expect(server.address()).toBeDefined()

    // Stop via instance method.
    await server.stop()
    expect(server.address()).toBeNull()

    const stop = await server.start()
    expect(server.address()).toBeDefined()

    // Stop via return value.
    await stop()
    expect(server.address()).toBeNull()
  })

  test('args: port', async () => {
    const server = Server.create({
      instance,
      port: 3000,
    })
    expect(server).toBeDefined()

    const stop = await server.start()
    expect(server.address()?.port).toBe(3000)
    await stop()
  })

  test('args: host', async () => {
    const server = Server.create({
      instance,
      host: 'localhost',
      port: 3000,
    })
    expect(server).toBeDefined()

    const stop = await server.start()
    expect(server.address()?.address).toBe('::1')
    expect(server.address()?.port).toBe(3000)
    await stop()
  })

  test('request: /healthcheck', async () => {
    const server = Server.create({
      instance,
    })

    const stop = await server.start()
    const { port } = server.address()!
    const response = await fetch(`http://localhost:${port}/healthcheck`)
    expect(response.status).toBe(200)

    await stop()
  })

  test('request: /start + /stop', async () => {
    const server = Server.create({
      instance,
    })

    const stop = await server.start()
    const { port } = server.address()!
    const response = await fetch(`http://localhost:${port}/1/start`)
    expect(response.status).toBe(200)

    const json = (await response.json()) as any
    expect(json.host).toBeDefined()
    expect(json.port).toBeDefined()
    expect(json.url).toBe(`http://${json.host}:${json.port}`)
    expect(json.endpoints.default).toEqual({
      host: json.host,
      port: json.port,
      protocol: 'http',
    })

    const response_err = await fetch(`http://localhost:${port}/1/start`)
    expect(response_err.status).toBe(400)
    expect(await response_err.json()).toEqual({
      message: `Instance "${instance.name}" is not in an idle or stopped state. Status: started`,
    })

    const response_stop = await fetch(`http://localhost:${port}/1/stop`)
    expect(response_stop.status).toBe(200)

    const response_2 = await fetch(`http://localhost:${port}/1/start`)
    expect(response_2.status).toBe(200)

    await stop()
  })

  test('request: /restart', async () => {
    const server = Server.create({
      instance,
    })

    const stop = await server.start()
    const { port } = server.address()!
    const response = await fetch(`http://localhost:${port}/1/restart`)
    expect(response.status).toBe(200)

    await stop()
  })
})

describe("instance: 'anvil'", () => {
  test('request: /{id}', async () => {
    const server = Server.create({
      instance: Instance.anvil(),
    })

    const stop = await server.start()
    const { port } = server.address()!
    const response = await fetch(`http://localhost:${port}/1`)
    // Standard Anvil HTTP response for invalid request.
    expect(response.status).toBe(400)
    expect(await response.text()).toBe(
      "Connection header did not include 'upgrade'",
    )

    // Check block numbers
    expect(
      await fetch(`http://localhost:${port}/1`, {
        body: JSON.stringify({
          method: 'eth_blockNumber',
          id: 0,
          jsonrpc: '2.0',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }).then((x) => x.json()),
    ).toMatchInlineSnapshot(`
      {
        "id": 0,
        "jsonrpc": "2.0",
        "result": "0x0",
      }
    `)
    expect(
      await fetch(`http://localhost:${port}/2`, {
        body: JSON.stringify({
          method: 'eth_blockNumber',
          id: 0,
          jsonrpc: '2.0',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }).then((x) => x.json()),
    ).toMatchInlineSnapshot(`
      {
        "id": 0,
        "jsonrpc": "2.0",
        "result": "0x0",
      }
    `)

    // Mine block number
    await fetch(`http://localhost:${port}/1`, {
      body: JSON.stringify({
        method: 'anvil_mine',
        params: ['0x69', '0x0'],
        id: 0,
        jsonrpc: '2.0',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    // Check block numbers
    expect(
      await fetch(`http://localhost:${port}/1`, {
        body: JSON.stringify({
          method: 'eth_blockNumber',
          id: 0,
          jsonrpc: '2.0',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }).then((x) => x.json()),
    ).toMatchInlineSnapshot(`
      {
        "id": 0,
        "jsonrpc": "2.0",
        "result": "0x69",
      }
    `)
    expect(
      await fetch(`http://localhost:${port}/2`, {
        body: JSON.stringify({
          method: 'eth_blockNumber',
          id: 0,
          jsonrpc: '2.0',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }).then((x) => x.json()),
    ).toMatchInlineSnapshot(`
      {
        "id": 0,
        "jsonrpc": "2.0",
        "result": "0x0",
      }
    `)

    await stop()
  })

  test('request: /restart', async () => {
    const server = Server.create({
      instance: Instance.anvil(),
    })

    const stop = await server.start()
    const { port } = server.address()!

    // Mine block number
    await fetch(`http://localhost:${port}/1`, {
      body: JSON.stringify({
        method: 'anvil_mine',
        params: ['0x69', '0x0'],
        id: 0,
        jsonrpc: '2.0',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })

    // Check block numbers
    expect(
      await fetch(`http://localhost:${port}/1`, {
        body: JSON.stringify({
          method: 'eth_blockNumber',
          id: 0,
          jsonrpc: '2.0',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }).then((x) => x.json()),
    ).toMatchInlineSnapshot(`
      {
        "id": 0,
        "jsonrpc": "2.0",
        "result": "0x69",
      }
    `)

    // Restart
    await fetch(`http://localhost:${port}/1/restart`)

    // Check block numbers
    expect(
      await fetch(`http://localhost:${port}/1`, {
        body: JSON.stringify({
          method: 'eth_blockNumber',
          id: 0,
          jsonrpc: '2.0',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }).then((x) => x.json()),
    ).toMatchInlineSnapshot(`
      {
        "id": 0,
        "jsonrpc": "2.0",
        "result": "0x0",
      }
    `)

    await stop()
  })

  test('request: /messages', async () => {
    const server = Server.create({
      instance: Instance.anvil(),
    })

    const stop = await server.start()
    const { port } = server.address()!

    await fetch(`http://localhost:${port}/1`)

    expect(
      (
        (await fetch(`http://localhost:${port}/1/messages`, {
          body: JSON.stringify({
            method: 'eth_blockNumber',
            id: 0,
            jsonrpc: '2.0',
          }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        }).then((x) => x.json())) as any
      ).length > 0,
    ).toBeTruthy()

    await stop()
  })

  test('ws', async () => {
    const server = Server.create({
      instance: Instance.anvil(),
    })

    const stop = await server.start()
    const { port } = server.address()!
    const ws = new WebSocket(`ws://localhost:${port}/1`)
    await new Promise((resolve) => ws.addEventListener('open', resolve))
    ws.send(
      JSON.stringify({
        method: 'eth_blockNumber',
        id: 0,
        jsonrpc: '2.0',
      }),
    )
    const { data } = await new Promise<MessageEvent>((resolve) =>
      ws.addEventListener('message', resolve),
    )
    expect(data).toMatchInlineSnapshot(
      `"{"jsonrpc":"2.0","id":0,"result":"0x0"}"`,
    )

    await stop()
  })
})

describe("instance: 'alto'", () => {
  test('request: /{id}', async () => {
    const server = Server.create({
      instance: Instance.alto(altoOptions({ port, pool: true })),
    })

    const stop = await server.start()
    const { port: port_2 } = server.address()!
    const response = await fetch(`http://localhost:${port_2}/1`, {
      body: JSON.stringify({
        method: 'eth_supportedEntryPoints',
        params: [],
        id: 0,
        jsonrpc: '2.0',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchInlineSnapshot(`
        {
          "id": 0,
          "jsonrpc": "2.0",
          "result": [
            "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
          ],
        }
      `)

    await stop()
  })
})

test('404', async () => {
  const server = Server.create({
    instance: Instance.anvil(),
  })

  const stop = await server.start()
  const { port } = server.address()!
  const response = await fetch(`http://localhost:${port}/wat`)
  expect(response.status).toBe(404)

  await stop()
})

describe('ready', () => {
  const rpcInstance = Instance.define(
    (options: {
      chainId: number
      failStart?: boolean | undefined
      // Requests that answer 503 before the node answers.
      warmup?: number | undefined
    }) => {
      let requests = 0
      let server: ReturnType<typeof createServer> | undefined
      return {
        host: '127.0.0.1',
        name: 'rpc',
        port: 0,
        async start({ port }) {
          if (options.failStart) throw new Error('image not found')
          server = createServer((_request, response) => {
            if (++requests <= (options.warmup ?? 0))
              return void response.writeHead(503).end()
            response.end(
              JSON.stringify({
                id: 1,
                jsonrpc: '2.0',
                result: `0x${options.chainId.toString(16)}`,
              }),
            )
          })
          await new Promise<void>((resolve) =>
            server!.listen(port, '127.0.0.1', resolve),
          )
        },
        async stop() {
          await new Promise<void>((resolve) => server?.close(() => resolve()))
        },
      }
    },
  )

  test('starts nothing without ready', async () => {
    const start = vi.fn()
    const server = Server.create({
      instance: Instance.define(() => ({
        host: 'localhost',
        name: 'lazy',
        port: 3000,
        start,
        async stop() {},
      }))(),
    })
    const stop = await server.start()
    expect(start).not.toHaveBeenCalled()
    await stop()
  })

  test('waits until every id answers with the chain ID', async () => {
    const server = Server.create({
      instance: rpcInstance({ chainId: 1337, warmup: 2 }),
      ready: { chainId: 1337, ids: [1, 2], timeout: 10_000 },
    })
    const stop = await server.start()
    try {
      expect(server.url(2)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/2$/)
      const messages = await Promise.all(
        [1, 2].map((id) =>
          fetch(server.url(id), { method: 'POST', body: '{}' }).then(
            (response) => response.json(),
          ),
        ),
      )
      expect(messages.map((message) => message.result)).toEqual([
        '0x539',
        '0x539',
      ])
    } finally {
      await stop()
    }
  })

  test('rejects and stops when an instance serves another chain', async () => {
    const server = Server.create({
      instance: rpcInstance({ chainId: 1 }),
      ready: { chainId: 1337, timeout: 10_000 },
    })
    await expect(server.start()).rejects.toThrowError(
      /^Instance at http:\/\/127\.0\.0\.1:\d+\/1 serves chain 1, not chain 1337\.$/,
    )
    expect(server.listening).toBe(false)
  })

  test('rejects at once when an instance fails to start', async () => {
    const server = Server.create({
      instance: rpcInstance({ chainId: 1, failStart: true }),
      ready: { timeout: 60_000 },
    })
    const started = Date.now()
    await expect(server.start()).rejects.toThrowError('image not found')
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(server.listening).toBe(false)
  })

  test('rejects after the timeout', async () => {
    const server = Server.create({
      instance: rpcInstance({ chainId: 1, warmup: Number.POSITIVE_INFINITY }),
      ready: { timeout: 1_000 },
    })
    await expect(server.start()).rejects.toThrowError(
      /did not answer `eth_chainId` within 1000ms \(last: 503 \)\.$/,
    )
    expect(server.listening).toBe(false)
  })

  test('rejects at the timeout while a start hangs', async () => {
    const release = Promise.withResolvers<void>()
    const server = Server.create({
      instance: Instance.define(() => ({
        host: 'localhost',
        name: 'hang',
        port: 3000,
        start: () => release.promise,
        async stop() {},
      }))(),
      ready: { timeout: 200 },
    })
    const started = Date.now()
    await expect(server.start()).rejects.toThrowError(
      /did not answer `eth_chainId` within 200ms/,
    )
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(server.listening).toBe(false)
    release.resolve()
  })

  describe('url', () => {
    test('checks the external URL instead of listening', async () => {
      const start = vi.fn()
      const external = Server.create({
        instance: rpcInstance({ chainId: 1337 }),
        ready: { chainId: 1337, ids: [1], timeout: 10_000 },
      })
      const stopExternal = await external.start()
      try {
        const server = Server.create({
          instance: Instance.define(() => ({
            host: 'localhost',
            name: 'unused',
            port: 3000,
            start,
            async stop() {},
          }))(),
          url: external.url(1),
        })
        const stop = await server.start()
        expect(server.listening).toBe(false)
        expect(server.address()).toBeNull()
        expect(server.url()).toBe(external.url(1))
        expect(server.url(2)).toBe(external.url(1))
        expect(start).not.toHaveBeenCalled()
        await stop()
      } finally {
        await stopExternal()
      }
    })

    test('rejects when the external URL does not answer', async () => {
      const port = await getPort()
      const server = Server.create({
        instance: Instance.anvil(),
        ready: { timeout: 1_000 },
        url: `http://127.0.0.1:${port}`,
      })
      await expect(server.start()).rejects.toThrowError(
        `Instance at http://127.0.0.1:${port} did not answer \`eth_chainId\` within 1000ms (last: fetch failed).`,
      )
    })
  })
})
