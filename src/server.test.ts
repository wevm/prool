import getPort from 'get-port'
import { beforeAll, describe, expect, test } from 'vitest'
import { type MessageEvent, WebSocket } from 'ws'
import {
  altoOptions,
  rundlerOptions,
  siliusOptions,
  stackupOptions,
} from '../test/utils.js'
import { rundler, silius } from './exports/instances.js'
import { alto } from './instances/alto.js'
import { anvil } from './instances/anvil.js'
import { stackup } from './instances/stackup.js'
import { createServer } from './server.js'

const port = await getPort()

beforeAll(async () => {
  await createServer({
    instance: anvil({
      chainId: 1,
      forkUrl: process.env.VITE_FORK_URL ?? 'https://eth.merkle.io',
    }),
    port,
  }).start()
})

describe.each([
  { instance: anvil() },
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
    const server = createServer({
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
    const server = createServer({
      instance,
      port: 3000,
    })
    expect(server).toBeDefined()

    const stop = await server.start()
    expect(server.address()?.port).toBe(3000)
    await stop()
  })

  test('args: host', async () => {
    const server = createServer({
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
    const server = createServer({
      instance,
    })

    const stop = await server.start()
    const { port } = server.address()!
    const response = await fetch(`http://localhost:${port}/healthcheck`)
    expect(response.status).toBe(200)

    await stop()
  })

  test('request: /start + /stop', async () => {
    const server = createServer({
      instance,
    })

    const stop = await server.start()
    const { port } = server.address()!
    const response = await fetch(`http://localhost:${port}/1/start`)
    expect(response.status).toBe(200)

    const json = (await response.json()) as any
    expect(json.host).toBeDefined()
    expect(json.port).toBeDefined()

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
    const server = createServer({
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
    const server = createServer({
      instance: anvil(),
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
    const server = createServer({
      instance: anvil(),
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
    const server = createServer({
      instance: anvil(),
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
    const server = createServer({
      instance: anvil(),
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
    const server = createServer({
      instance: alto(altoOptions({ port, pool: true })),
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

describe("instance: 'stackup'", () => {
  test('request: /{id}', async () => {
    const server = createServer({
      instance: stackup(stackupOptions({ port, pool: true })),
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
            "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
          ],
        }
      `)

    await stop()
  })
})

describe("instance: 'rundler'", () => {
  test('request: /{id}', async () => {
    const server = createServer({
      instance: rundler(rundlerOptions({ port, pool: true })),
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

describe("instance: 'silius'", () => {
  test(
    'request: /{id}',
    async () => {
      const server = createServer({
        instance: silius(siliusOptions({ port, pool: true })),
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
    },
    { timeout: 10_000 },
  )
})

test('404', async () => {
  const server = createServer({
    instance: anvil(),
  })

  const stop = await server.start()
  const { port } = server.address()!
  const response = await fetch(`http://localhost:${port}/wat`)
  expect(response.status).toBe(404)

  await stop()
})
