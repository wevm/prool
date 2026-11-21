import * as os from 'node:os'
import * as path from 'node:path'
import { beforeEach, expect, test, vi } from 'vitest'
import { tempo } from './tempo.js'

const { dumpGenesis, execute, spawn } = vi.hoisted(() => {
  const spawn = vi.fn<(strings: TemplateStringsArray, args: string[]) => void>()
  return {
    dumpGenesis: vi.fn(async () => ({
      stdout: JSON.stringify({
        config: { chainId: 1337, t9Time: 0, t10Time: 1 },
        alloc: {},
      }),
    })),
    execute: vi.fn(() => spawn),
    spawn,
  }
})

vi.mock('execa', () => ({ execa: dumpGenesis }))
vi.mock('../processes/execa.js', () => ({
  execa: () => ({
    _internal: {},
    async start(callback: (exec: typeof execute) => unknown) {
      callback(execute)
    },
    async stop() {},
  }),
}))

beforeEach(() => vi.clearAllMocks())

const custom = path.join(os.tmpdir(), 'prool-custom-datadir')
const transform: NonNullable<tempo.Parameters['genesis']> = (genesis) => genesis
const cases: {
  name: string
  parameters: tempo.Parameters
  expected: string | RegExp
}[] = [
  {
    name: 'default',
    parameters: {},
    expected: path.join(os.tmpdir(), '.prool', 'tempo.8545'),
  },
  {
    name: 'undefined datadir',
    parameters: { datadir: undefined },
    expected: path.join(os.tmpdir(), '.prool', 'tempo.8545'),
  },
  {
    name: 'hardfork',
    parameters: { hardfork: 'T9' },
    expected: path.join(os.tmpdir(), '.prool', 'tempo.8545.T9'),
  },
  {
    name: 'explicit datadir',
    parameters: { datadir: custom },
    expected: custom,
  },
  {
    name: 'hardfork with explicit datadir',
    parameters: { hardfork: 'T9', datadir: custom },
    expected: custom,
  },
  {
    name: 'genesis transform',
    parameters: { genesis: transform },
    expected: /tempo\.8545\.genesis-[a-f0-9]{16}$/,
  },
  {
    name: 'genesis with explicit datadir',
    parameters: { genesis: transform, datadir: custom },
    expected: custom,
  },
]

test.each(cases)('start preserves datadir: $name', async ({
  parameters,
  expected,
}) => {
  const instance = tempo(parameters)
  await instance.start()
  try {
    expect(spawn).toHaveBeenCalledOnce()
    const args = spawn.mock.calls[0]![1]
    const index = args.indexOf('--datadir')
    expect(index).toBeGreaterThan(-1)
    if (typeof expected === 'string') expect(args[index + 1]).toBe(expected)
    else expect(args[index + 1]).toMatch(expected)
  } finally {
    await instance.stop()
  }
})

test('does not start the node when dumping genesis fails', async () => {
  dumpGenesis.mockRejectedValueOnce(new Error('dump-genesis failed'))
  await expect(tempo({ hardfork: 'T9' }).start()).rejects.toThrow(
    'dump-genesis failed',
  )
  expect(spawn).not.toHaveBeenCalled()
})

test('uses the created instance port for the default datadir', async () => {
  const instance = tempo().create({ port: 9545 })
  await instance.start()
  try {
    const args = spawn.mock.calls[0]![1]
    const index = args.indexOf('--datadir')
    expect(index).toBeGreaterThan(-1)
    expect(args[index + 1]).toBe(path.join(os.tmpdir(), '.prool', 'tempo.9545'))
  } finally {
    await instance.stop()
  }
})
