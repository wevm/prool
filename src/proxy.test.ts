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
  },
)
