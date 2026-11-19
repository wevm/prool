import { Instance, Server } from 'prool'
import { Setup } from 'prool/playwright'
import { describe, expectTypeOf, test } from 'vitest'

describe('define', () => {
  test('passes started services to env', () => {
    const chain = Server.create({ instance: Instance.anvil() })
    Setup.define({
      instances: {
        chain,
        node: () => Instance.anvil({ forkUrl: chain.url(1) }),
      },
      env(started) {
        expectTypeOf(started.chain).toEqualTypeOf<typeof chain>()
        expectTypeOf(started.node.url).toEqualTypeOf<string>()
        // @ts-expect-error Only configured names are available.
        started.other
        return { RPC_URL: started.chain.url(1) }
      },
    })
  })

  test('rejects values that cannot start', () => {
    Setup.define({
      // @ts-expect-error A service has `start` and `stop`.
      instances: { chain: { url: 'http://localhost:8545' } },
    })
  })
})
