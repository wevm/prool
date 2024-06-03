import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from 'node:http'

import type { DefinePoolParameters } from './pool.js'

export type DefineProxyPoolParameters = DefinePoolParameters

export type DefineProxyPoolReturnType = Server<
  typeof IncomingMessage,
  typeof ServerResponse
> & {
  start(): Promise<() => Promise<void>>
  stop(): Promise<void>
}

export function defineProxyPool(
  _parameters: DefineProxyPoolParameters,
): DefineProxyPoolReturnType {
  const server = createServer()

  return Object.assign(server, {
    start() {
      return new Promise<() => Promise<void>>((resolve) => {
        server.listen(() => resolve(this.stop))
      })
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  })
}
