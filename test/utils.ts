import { resolve } from 'node:path'

const poolId = Math.floor(Math.random() * 10000)

export const altoOptions = ({ port, pool }: { port: number; pool: boolean }) =>
  ({
    entrypoints: ['0x0000000071727De22E5E9d8BAf0edAc6f37da032'],
    rpcUrl: `http://localhost:${port}${pool ? `/${poolId}` : ''}`,
    executorPrivateKeys: [
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    ],
    utilityPrivateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  }) as const

export const rundlerOptions = ({
  port,
  pool,
}: { port: number; pool: boolean }) =>
  ({
    nodeHttp: `http://localhost:${port}${pool ? `/${poolId}` : ''}`,
    builder: {
      privateKey:
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    },
  }) as const

export const siliusOptions = ({
  port,
  pool,
}: { port: number; pool: boolean }) =>
  ({
    ethClientAddress: `http://localhost:${port}${pool ? `/${poolId}` : ''}`,
    mnemonicPath: resolve(
      import.meta.dirname,
      './silius/keys/0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    ),
  }) as const

export const stackupOptions = ({
  port,
  pool,
}: { port: number; pool: boolean }) =>
  ({
    ethClientUrl: `http://localhost:${port}${pool ? `/${poolId}` : ''}`,
    privateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  }) as const
