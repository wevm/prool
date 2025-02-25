import { resolve } from 'node:path'
import type { RundlerParameters } from '../src/instances/rundler.js'

export const altoOptions = ({ port }: { port: number }) =>
  ({
    entrypoints: ['0x0000000071727De22E5E9d8BAf0edAc6f37da032'],
    rpcUrl: `http://localhost:${port}`,
    executorPrivateKeys: [
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    ],
  }) as const

export const rundlerOptions = ({
  port,
}: { port: number }): RundlerParameters => ({
  nodeHttp: `http://localhost:${port}`,
  builder: {
    privateKeys: [
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    ],
  },
})

export const siliusOptions = ({ port }: { port: number }) =>
  ({
    ethClientAddress: `http://localhost:${port}`,
    mnemonicPath: resolve(
      import.meta.dirname,
      './silius/keys/0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    ),
  }) as const

export const stackupOptions = ({ port }: { port: number }) =>
  ({
    ethClientUrl: `http://localhost:${port}`,
    privateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  }) as const
