import { Instance } from 'prool/testcontainers'
import { describe, expect, expectTypeOf, test } from 'vitest'

describe('tempoLocalnetCommand', () => {
  test.each([
    { expected: [], parameters: {} },
    { expected: ['--bare'], parameters: { bare: true } },
    {
      expected: ['--block-time', '200ms'],
      parameters: { blockTime: '200ms' },
    },
    {
      expected: ['--bare', '--block-time', '1s'],
      parameters: { bare: true, blockTime: '1s' },
    },
  ])('$expected', ({ expected, parameters }) => {
    expect(Instance.tempoLocalnet(parameters)._internal.command).toEqual(
      expected,
    )
  })
})

test('defines the bootstrapped localnet endpoint', () => {
  const instance = Instance.tempoLocalnet({
    bare: true,
    blockTime: '200ms',
  })

  expect(instance.name).toBe('tempo-localnet')
  expect(instance.host).toBe('localhost')
  expect(instance.port).toBe(8545)
  expect(instance.url).toBe('http://localhost:8545')
  expect(instance._internal.args).toEqual({
    bare: true,
    blockTime: '200ms',
  })
  expect(instance._internal.command).toEqual([
    '--bare',
    '--block-time',
    '200ms',
  ])
  expectTypeOf(instance).toMatchTypeOf<Instance.Instance>()
})

test.skipIf(process.env['TEST_TEMPO_LOCALNET'] !== 'true')(
  'starts a healthy bootstrapped localnet',
  { timeout: 240_000 },
  async () => {
    const instance = Instance.tempoLocalnet({
      blockTime: '1ms',
      image:
        'ghcr.io/tempoxyz/tempo-localnet@sha256:86f199f161be85d3610d990e5bc2653ece29de3ee9c91e8c8e768cf2b8c05c3b',
    })

    try {
      await instance.start()
      const rpc = async (method: string, params: unknown[] = []) => {
        const response = await fetch(instance.url, {
          body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        return (await response.json()) as { result: unknown }
      }

      expect(await rpc('eth_chainId')).toMatchObject({ result: '0x539' })
      const funded = await rpc('tempo_fundAddress', [
        '0x000000000000000000000000000000000000beef',
      ])
      expect(funded.result).toEqual([
        expect.stringMatching(/^0x[0-9a-f]{64}$/),
        expect.stringMatching(/^0x[0-9a-f]{64}$/),
        expect.stringMatching(/^0x[0-9a-f]{64}$/),
        expect.stringMatching(/^0x[0-9a-f]{64}$/),
      ])
    } finally {
      await instance.stop().catch(() => {})
    }
  },
)
