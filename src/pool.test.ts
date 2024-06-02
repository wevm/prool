import { expect, test } from 'vitest'
import { anvil } from './instances/ethereum/anvil.js'
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
    }
  `)
})
