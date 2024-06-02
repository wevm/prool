import { expect, test } from 'vitest'
import { anvil } from './instances/anvil.js'
import { definePool } from './pool.js'

test('default', async () => {
  const pool = definePool({
    instance: anvil(),
  })

  expect(pool).toMatchInlineSnapshot(`
    {
      "_internal": {
        "instance": {
          "_internal": {
            "process": undefined,
          },
          "addListener": [Function],
          "create": [Function],
          "host": "127.0.0.1",
          "messages": {
            "clear": [Function],
            "get": [Function],
          },
          "name": "anvil",
          "off": [Function],
          "on": [Function],
          "once": [Function],
          "port": 8545,
          "removeAllListeners": [Function],
          "removeListener": [Function],
          "start": [Function],
          "status": "idle",
          "stop": [Function],
        },
      },
      "entries": [Function],
      "forEach": [Function],
      "get": [Function],
      "has": [Function],
      "keys": [Function],
      "size": 0,
      "start": [Function],
      "values": [Function],
    }
  `)
})

test.skip('start', async () => {
  const pool = definePool({
    instance: anvil(),
  })

  expect(pool.size).toEqual(0)

  const instance_1 = await pool.start(1)
  expect(instance_1).toMatchInlineSnapshot(``)
  expect(pool.size).toEqual(1)

  const instance_2 = await pool.start(2)
  expect(pool.size).toEqual(2)
})
