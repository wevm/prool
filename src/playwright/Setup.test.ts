import { Instance } from 'prool'
import { Setup } from 'prool/playwright'
import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
})

function service(name: string, log: string[], fail?: 'start' | 'stop') {
  return {
    async start() {
      log.push(`start ${name}`)
      if (fail === 'start') throw new Error(`${name} start failed`)
    },
    async stop() {
      log.push(`stop ${name}`)
      if (fail === 'stop') throw new Error(`${name} stop failed`)
    },
  }
}

describe('define', () => {
  test('starts in order, sets env, and tears down in reverse', async () => {
    vi.stubEnv('PROOL_TEST_URL', undefined)
    vi.stubEnv('PROOL_TEST_KEPT', 'kept')
    const log: string[] = []
    const node = Instance.define(() => ({
      host: 'localhost',
      name: 'node',
      port: 4000,
      async start() {
        log.push('start node')
      },
      async stop() {
        log.push('stop node')
      },
    }))()
    const factory = vi.fn(() => {
      // A factory runs only after the services before it have started.
      expect(log).toEqual(['start first'])
      return node
    })
    const setup = Setup.define({
      instances: { first: service('first', log), node: factory },
      env: (started) => ({
        PROOL_TEST_KEPT: undefined,
        PROOL_TEST_URL: started.node.url,
      }),
    })

    const teardown = await setup()
    expect(log).toEqual(['start first', 'start node'])
    expect(process.env['PROOL_TEST_URL']).toBe('http://localhost:4000')
    expect(process.env['PROOL_TEST_KEPT']).toBe('kept')

    await teardown()
    expect(log).toEqual([
      'start first',
      'start node',
      'stop node',
      'stop first',
    ])
    expect(factory).toHaveBeenCalledOnce()
  })

  test('rolls back started services when a later one fails', async () => {
    const log: string[] = []
    const env = vi.fn(() => ({}))
    const setup = Setup.define({
      instances: {
        a: service('a', log),
        b: service('b', log),
        c: service('c', log, 'start'),
        d: service('d', log),
      },
      env,
    })

    await expect(setup()).rejects.toThrowError('c start failed')
    expect(log).toEqual(['start a', 'start b', 'start c', 'stop b', 'stop a'])
    expect(env).not.toHaveBeenCalled()
  })

  test('reports start and rollback failures together', async () => {
    const log: string[] = []
    const setup = Setup.define({
      instances: {
        a: service('a', log),
        b: service('b', log, 'stop'),
        c: service('c', log, 'start'),
      },
    })

    const error = await setup().catch((error: unknown) => error)
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([
      new Error('c start failed'),
      new Error('b stop failed'),
    ])
    expect(log).toEqual(['start a', 'start b', 'start c', 'stop b', 'stop a'])
  })

  test('attempts every teardown when one fails', async () => {
    const log: string[] = []
    const setup = Setup.define({
      instances: {
        a: service('a', log, 'stop'),
        b: service('b', log),
        c: service('c', log, 'stop'),
      },
    })
    const teardown = await setup()

    const error = await teardown().catch((error: unknown) => error)
    expect((error as AggregateError).errors).toEqual([
      new Error('c stop failed'),
      new Error('a stop failed'),
    ])
    expect(log.slice(3)).toEqual(['stop c', 'stop b', 'stop a'])
  })
})
