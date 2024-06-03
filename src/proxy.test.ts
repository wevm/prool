import { describe, expect, test } from 'vitest'
import { type MessageEvent, WebSocket } from 'ws'
import { anvil } from './instances/anvil.js'
import { defineProxyPool } from './proxy.js'

describe.each([{ instance: anvil() }])(
  'instance: $instance.name',
  ({ instance }) => {
    test('default', async () => {
      const pool = defineProxyPool({
        instance,
      })
      expect(pool).toBeDefined()

      await pool.start()
      expect(pool.address()).toBeDefined()

      // Stop via instance method.
      await pool.stop()
      expect(pool.address()).toBeNull()

      const stop = await pool.start()
      expect(pool.address()).toBeDefined()

      // Stop via return value.
      await stop()
      expect(pool.address()).toBeNull()
    })

    test('args: port', async () => {
      const pool = defineProxyPool({
        instance,
        port: 3000,
      })
      expect(pool).toBeDefined()

      const stop = await pool.start()
      expect(pool.address()?.port).toBe(3000)
      await stop()
    })

    test('args: host', async () => {
      const pool = defineProxyPool({
        instance,
        host: 'localhost',
        port: 3000,
      })
      expect(pool).toBeDefined()

      const stop = await pool.start()
      expect(pool.address()?.address).toBe('::1')
      expect(pool.address()?.port).toBe(3000)
      await stop()
    })

    test('request: /healthcheck', async () => {
      const server = defineProxyPool({
        instance,
      })

      const stop = await server.start()
      const { port } = server.address()!
      const response = await fetch(`http://localhost:${port}/healthcheck`)
      expect(response.status).toBe(200)

      await stop()
    })

    test('request: /start + /stop', async () => {
      const server = defineProxyPool({
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

    test('ws', async () => {
      const server = defineProxyPool({
        instance,
      })

      const stop = await server.start()
      const { port } = server.address()!
      const ws = new WebSocket(`ws://localhost:${port}/1`)
      await new Promise((resolve) => ws.addEventListener('open', resolve))
      ws.send('test')
      await new Promise((resolve) => ws.addEventListener('message', resolve))

      await stop()
    })
  },
)

describe("instance: 'anvil'", () => {
  test('request: /{id}', async () => {
    const server = defineProxyPool({
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

  test('request: /messages', async () => {
    const server = defineProxyPool({
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
    const server = defineProxyPool({
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

test('404', async () => {
  const server = defineProxyPool({
    instance: anvil(),
  })

  const stop = await server.start()
  const { port } = server.address()!
  const response = await fetch(`http://localhost:${port}/wat`)
  expect(response.status).toBe(404)

  await stop()
})
