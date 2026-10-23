import { expect, test } from 'vitest'
import { configureGenesis, prepareGenesis } from './tempoGenesis.js'

const genesis = JSON.stringify({
  config: {
    chainId: 1337,
    pragueTime: 0,
    t0Time: 0,
    t10Time: 100,
    t11Time: 200,
    t1Time: 50,
    t1aTime: 60,
    t1bTime: 70,
    t1cTime: 80,
    t2Time: 90,
    t9Time: 99,
  },
  alloc: { '0x1234': { balance: '0x1', code: '0x00' } },
})

test('enables preceding forks and removes later forks', () => {
  expect(JSON.parse(configureGenesis(genesis, 'T10'))).toEqual({
    config: {
      chainId: 1337,
      pragueTime: 0,
      t0Time: 0,
      t1Time: 0,
      t1aTime: 0,
      t1bTime: 0,
      t1cTime: 0,
      t2Time: 0,
      t9Time: 0,
      t10Time: 0,
    },
    alloc: { '0x1234': { balance: '0x1', code: '0x00' } },
  })
})

test.each([
  ['T1', ['t0Time', 't1Time']],
  ['T1A', ['t0Time', 't1Time', 't1aTime']],
  ['T1B', ['t0Time', 't1Time', 't1aTime', 't1bTime']],
])('orders subforks for %s', (hardfork, expected) => {
  const { config } = JSON.parse(configureGenesis(genesis, hardfork))
  expect(Object.keys(config).filter((key) => key.startsWith('t'))).toEqual(
    expected,
  )
})

test('rejects a fork absent from genesis', () => {
  expect(() => configureGenesis(genesis, 'T99')).toThrow(
    'Hardfork "T99" is not present in the Tempo genesis.',
  )
})

test('applies the hardfork, then the transform', () => {
  const prepared = JSON.parse(
    prepareGenesis(genesis, {
      hardfork: 'T1',
      transform: (value) => ({
        ...value,
        config: { ...value.config, recoveryFactory: '0x7171', t0Time: 5 },
      }),
    }),
  )
  expect(prepared.config).toEqual({
    chainId: 1337,
    pragueTime: 0,
    recoveryFactory: '0x7171',
    t0Time: 5,
    t1Time: 0,
  })
  expect(prepared.alloc).toEqual({ '0x1234': { balance: '0x1', code: '0x00' } })
})

test('returns the genesis unchanged without a hardfork or transform', () => {
  expect(prepareGenesis(genesis, {})).toBe(genesis)
})
