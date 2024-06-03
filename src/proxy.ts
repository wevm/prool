import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { createProxyServer } from 'http-proxy'

import { type DefinePoolParameters, definePool } from './pool.js'
import { extractPath } from './utils.js'

export type DefineProxyPoolParameters = DefinePoolParameters &
  (
    | {
        /** Host to run the server on. */
        host?: string | undefined
        /** Port to run the server on. */
        port: number
      }
    | {
        host?: undefined
        port?: undefined
      }
  )

export type DefineProxyPoolReturnType = Omit<
  Server<typeof IncomingMessage, typeof ServerResponse>,
  'address'
> & {
  address(): AddressInfo | null
  start(): Promise<() => Promise<void>>
  stop(): Promise<void>
}

export function defineProxyPool(
  parameters: DefineProxyPoolParameters,
): DefineProxyPoolReturnType {
  const { host = '::', instance, limit, port } = parameters

  const pool = definePool({ instance, limit })
  const proxy = createProxyServer({
    ignorePath: true,
    ws: true,
  })

  const server = createServer(async (request, response) => {
    const url = request.url
    if (!url) {
      response.end()
      return
    }

    const { id, path } = extractPath(url)

    if (id && path === '/') {
      const { host, port } = pool.get(id) || (await pool.start(id))
      return proxy.web(request, response, {
        target: `http://${host}:${port}`,
      })
    }

    if (path === '/healthcheck') response.end(':-)')

    return
  })

  return Object.assign(server as any, {
    start() {
      return new Promise<() => Promise<void>>((resolve) => {
        if (port) server.listen(port, host, () => resolve(this.stop))
        else server.listen(() => resolve(this.stop))
      })
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  })
}
