import { Instance } from 'prool'
import { Server } from 'prool/vitest'
import { describe, expectTypeOf, test } from 'vitest'

describe('setup', () => {
  test('infers named contexts and worker factories', () => {
    Server.setup({
      instances: {
        l1: Instance.anvil(),
        l2: (id) => {
          expectTypeOf(id).toEqualTypeOf<number>()
          return Instance.anvil()
        },
      },
      setup(contexts, project) {
        expectTypeOf(contexts.l1).toEqualTypeOf<Server.Context>()
        expectTypeOf(contexts.l2).toEqualTypeOf<Server.Context>()
        expectTypeOf(project).toEqualTypeOf<Server.setup.Project>()
        // @ts-expect-error Only configured names are available.
        contexts.l3
      },
    })
  })

  test('rejects mixed single and named definitions', () => {
    // @ts-expect-error Setup accepts either instance or instances.
    Server.setup({
      instance: Instance.anvil(),
      instances: { l1: Instance.anvil() },
      setup() {},
    })
  })
})

describe('get', () => {
  test('preserves named controls and single contexts', () => {
    expectTypeOf(
      Server.get({ url: 'http://localhost:3000' }),
    ).toEqualTypeOf<Server.Server>()
    const servers = Server.get({
      l1: { url: 'http://localhost:3000' },
      l2: { url: 'http://localhost:4000' },
    })
    expectTypeOf(servers.l1).toEqualTypeOf<Server.Server>()
    expectTypeOf(servers.l2).toEqualTypeOf<Server.Server>()
    // @ts-expect-error Only configured names are available.
    servers.l3
  })
})
