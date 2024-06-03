import { createServer } from 'node:http'

import type { DefinePoolParameters } from './pool.js'

export type DefineProxyPoolParameters = DefinePoolParameters

export function defineProxyPool(_parameters: DefineProxyPoolParameters) {
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
