import { createServer } from 'node:http'
import { expect, test, vi } from 'vitest'
import * as Instance from './Instance.js'
import * as Server from './Server.js'

async function withUpstream(
  result: (attempt: number) => string,
  check: (
    server: ReturnType<typeof Server.create>,
    attempts: () => number,
  ) => Promise<void>,
  chainId?: number,
) {
  let attempts = 0
  const upstream = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({ id: 1, jsonrpc: '2.0', result: result(++attempts) }),
    )
  })
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  try {
    const address = upstream.address()
    if (!address || typeof address === 'string')
      throw new Error('missing upstream address')
    const start = vi.fn()
    const server = Server.create({
      instance: Instance.define(() => ({
        host: '127.0.0.1',
        name: 'unused',
        port: 0,
        start,
        async stop() {},
      }))(),
      ready: { chainId, timeout: 2_000 },
      url: `http://127.0.0.1:${address.port}`,
    })
    await check(server, () => attempts)
    expect(start).not.toHaveBeenCalled()
    expect(server.listening).toBe(false)
  } finally {
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

test.each([
  'initializing',
  '',
  '42',
])('waits past invalid chain ID %j', async (invalid) => {
  await withUpstream(
    (attempt) => (attempt === 1 ? invalid : '0x2a'),
    async (server, attempts) => {
      await (await server.start())()
      expect(attempts()).toBe(2)
    },
  )
})

test('does not accept a decimal response matching the expected chain ID', async () => {
  await withUpstream(
    (attempt) => (attempt === 1 ? '42' : '0x2a'),
    async (server, attempts) => {
      await (await server.start())()
      expect(attempts()).toBe(2)
    },
    42,
  )
})

test('accepts a valid chain ID on the first probe', async () => {
  await withUpstream(
    () => '0x0',
    async (server, attempts) => {
      await (await server.start())()
      expect(attempts()).toBe(1)
    },
  )
})

test('times out when the chain ID remains invalid', async () => {
  await withUpstream(
    () => 'initializing',
    async (server) => {
      await expect(server.start()).rejects.toThrow(
        /did not answer `eth_chainId` within 2000ms/,
      )
    },
  )
})

test('still rejects a valid response from the wrong chain', async () => {
  await withUpstream(
    () => '0x1',
    async (server, attempts) => {
      await expect(server.start()).rejects.toThrow(
        'serves chain 1, not chain 42.',
      )
      expect(attempts()).toBe(1)
    },
    42,
  )
})
