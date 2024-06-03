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
    try {
      const url = request.url
      if (!url) {
        response.end()
        return
      }

      const { id, path } = extractPath(url)

      if (typeof id === 'number' && path === '/') {
        const { host, port } = pool.get(id) || (await pool.start(id))
        return proxy.web(request, response, {
          target: `http://${host}:${port}`,
        })
      }
      if (typeof id === 'number' && path === '/start') {
        const { host, port } = await pool.start(id)
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ host, port }))
        return
      }
      if (typeof id === 'number' && path === '/stop') {
        await pool.stop(id)
        response.writeHead(200, { 'Content-Type': 'application/json' }).end()
        return
      }
      if (typeof id === 'number' && path === '/messages') {
        const messages = pool.get(id)?.messages.get() || []
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(messages))
        return
      }

      if (path === '/healthcheck') {
        response.writeHead(200, { 'Content-Type': 'application/json' }).end()
        return
      }

      response.writeHead(404, { 'Content-Type': 'application/json' }).end()
      return
    } catch (error) {
      response
        .writeHead(400, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ message: (error as Error).message }))
      return
    }
  })

  server.on('upgrade', async (request, socket, head) => {
    const url = request.url
    if (!url) {
      socket.destroy(new Error('Unsupported request'))
      return
    }

    const { id, path } = extractPath(url)

    if (typeof id === 'number' && path === '/') {
      const { host, port } = pool.get(id) || (await pool.start(id))
      proxy.ws(request, socket, head, {
        target: `ws://${host}:${port}`,
      })
      return
    }

    socket.destroy(new Error('Unsupported request'))
    return
  })

  return Object.assign(server as any, {
    start() {
      return new Promise<() => Promise<void>>((resolve) => {
        if (port) server.listen(port, host, () => resolve(this.stop))
        else server.listen(() => resolve(this.stop))
      })
    },
    async stop() {
      await Promise.allSettled([
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
        pool.destroyAll(),
      ])
    },
  })
}
