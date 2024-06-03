import { describe, expect, test } from 'vitest'
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
      expect(await response.text()).toBe(':-)')

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

    await fetch(`http://localhost:${port}/1`)

    await stop()
  })
})
