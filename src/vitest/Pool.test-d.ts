import { Instance } from 'prool'
import { Pool } from 'prool/vitest'
import { describe, expectTypeOf, test } from 'vitest'

describe('setup', () => {
  test('preserves heterogeneous endpoints through definitions and factories', () => {
    const metrics = Instance.define(() => ({
      name: 'metrics',
      host: 'localhost',
      port: 3000,
      endpoints: {
        metrics: { host: 'localhost', port: 9000, protocol: 'http' as const },
      },
      async start() {},
      async stop() {},
    }))()
    const socket = Instance.define(() => ({
      name: 'socket',
      host: 'localhost',
      port: 4000,
      endpoints: {
        socket: { host: 'localhost', port: 9001, protocol: 'ws' as const },
      },
      async start() {},
      async stop() {},
    }))()
    expectTypeOf<
      Pool.setup.Instances<{
        choice: typeof metrics | ((id: number) => typeof socket)
      }>['choice']
    >().toEqualTypeOf<
      Omit<typeof metrics, 'create'> | Omit<typeof socket, 'create'>
    >()
    Pool.setup({
      instances: {
        l1: metrics,
        l2: (id) => {
          expectTypeOf(id).toEqualTypeOf<number>()
          return socket
        },
      },
      setup(instances, project) {
        expectTypeOf(
          instances[0]!.l1.endpoints.metrics.protocol,
        ).toEqualTypeOf<'http'>()
        expectTypeOf(
          instances[0]!.l2.endpoints.socket.protocol,
        ).toEqualTypeOf<'ws'>()
        expectTypeOf(project).toEqualTypeOf<Pool.setup.Project>()
        // @ts-expect-error Endpoints belong to their named definition.
        instances[0]!.l1.endpoints.socket
        // @ts-expect-error Only configured names are available.
        instances[0]!.l3
      },
    })
  })

  test('rejects mixed single and named definitions', () => {
    // @ts-expect-error Setup accepts either instance or instances.
    Pool.setup({
      instance: Instance.anvil(),
      instances: { l1: Instance.anvil() },
      setup() {},
    })
  })
})

describe('get', () => {
  test('preserves named values for the worker', () => {
    const urls = Pool.get([
      { l1: 'http://localhost:3000', l2: 'http://localhost:4000' },
    ] as const)
    expectTypeOf(urls.l1).toEqualTypeOf<'http://localhost:3000'>()
    expectTypeOf(urls.l2).toEqualTypeOf<'http://localhost:4000'>()
  })
})
