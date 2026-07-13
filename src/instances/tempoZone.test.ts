import * as os from 'node:os'
import { expect, test } from 'vitest'
import { command } from './tempoZone.js'

const redact = (args: string[]) =>
  args.join(' ').replaceAll(os.tmpdir(), '<tmpdir>')

test('command: default', () => {
  expect(redact(command({ port: 9545 }))).toMatchInlineSnapshot(
    `"dev --datadir <tmpdir>/.prool/tempo-zone.9545 --http.addr 0.0.0.0 --http.port 9545 --l1.rpc-url ws://localhost:8546 --private-rpc.port 9548 -- --ipcdisable"`,
  )
})

test('command: behavior: l1 options', () => {
  expect(
    redact(
      command({
        l1: {
          factoryAddress: '0x00000000000000000000000000000000000fac70',
          rpcUrl: 'ws://l1:8546',
        },
        port: 9545,
      }),
    ),
  ).toMatchInlineSnapshot(
    `"dev --datadir <tmpdir>/.prool/tempo-zone.9545 --http.addr 0.0.0.0 --http.port 9545 --l1.rpc-url ws://l1:8546 --l1.factory-address 0x00000000000000000000000000000000000fac70 --private-rpc.port 9548 -- --ipcdisable"`,
  )
})

test('command: behavior: dev options', () => {
  expect(
    redact(
      command({
        dev: {
          key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
          token: '0x20c0000000000000000000000000000000000001',
        },
        port: 9545,
      }),
    ),
  ).toMatchInlineSnapshot(
    `"dev --datadir <tmpdir>/.prool/tempo-zone.9545 --http.addr 0.0.0.0 --http.port 9545 --l1.rpc-url ws://localhost:8546 --private-rpc.port 9548 --dev.key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --dev.token 0x20c0000000000000000000000000000000000001 -- --ipcdisable"`,
  )
})

test('command: behavior: node args', () => {
  expect(
    redact(command({ nodeArgs: ['--full'], port: 9545 })),
  ).toMatchInlineSnapshot(
    `"dev --datadir <tmpdir>/.prool/tempo-zone.9545 --http.addr 0.0.0.0 --http.port 9545 --l1.rpc-url ws://localhost:8546 --private-rpc.port 9548 -- --ipcdisable --full"`,
  )
})

test('command: behavior: private rpc port override', () => {
  expect(
    redact(command({ port: 9545, privateRpc: { port: 1337 } })),
  ).toMatchInlineSnapshot(
    `"dev --datadir <tmpdir>/.prool/tempo-zone.9545 --http.addr 0.0.0.0 --http.port 9545 --l1.rpc-url ws://localhost:8546 --private-rpc.port 1337 -- --ipcdisable"`,
  )
})

test('command: behavior: instance options are not forwarded', () => {
  expect(
    redact(
      command({
        binary: '/usr/local/bin/tempo-zone',
        host: '127.0.0.1',
        log: 'error',
        port: 9545,
      }),
    ),
  ).toMatchInlineSnapshot(
    `"dev --datadir <tmpdir>/.prool/tempo-zone.9545 --http.addr 0.0.0.0 --http.port 9545 --l1.rpc-url ws://localhost:8546 --private-rpc.port 9548 -- --ipcdisable"`,
  )
})
