import { Network } from 'prool/testcontainers'
import { expect, test } from 'vitest'

test.each([
  ['http://127.0.0.1:8545/1', 'http://host.docker.internal:8545/1'],
  ['http://localhost:8545/', 'http://host.docker.internal:8545'],
  ['ws://[::1]:8546/2?x=1', 'ws://host.docker.internal:8546/2?x=1'],
  ['https://rpc.example.org/v1/', 'https://rpc.example.org/v1'],
  ['http://127.0.0.2:8545', 'http://127.0.0.2:8545'],
])('reachable(%s)', (url, expected) => {
  expect(Network.reachable(url)).toBe(expected)
})
