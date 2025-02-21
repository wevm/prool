import {
  type IncomingMessage,
  type Server,
  type ServerResponse,
  createServer as createServer_,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import httpProxy from 'http-proxy'

import { type DefinePoolParameters, definePool } from './pool.js'
import { extractPath } from './utils.js'

const { createProxyServer } = httpProxy

export type CreateServerParameters = DefinePoolParameters<number> &
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

export type CreateServerReturnType = Omit<
  Server<typeof IncomingMessage, typeof ServerResponse>,
  'address'
> & {
  address(): AddressInfo | null
  start(): Promise<() => Promise<void>>
  stop(): Promise<void>
}

/**
 * Creates a server that manages a pool of instances via a proxy.
 *
 * @example
 * ```
 * import { createServer } from 'prool'
 * import { anvil } from 'prool/instances'
 *
 * const server = createServer({
 *  instance: anvil(),
 * })
 *
 * const server = await server.start()
 * // Instances accessible at:
 * // "http://localhost:8545/1"
 * // "http://localhost:8545/2"
 * // "http://localhost:8545/3"
 * // "http://localhost:8545/n"
 * // "http://localhost:8545/n/start"
 * // "http://localhost:8545/n/stop"
 * // "http://localhost:8545/n/restart"
 * // "http://localhost:8545/healthcheck"
 * ```
 */
export function createServer(
  parameters: CreateServerParameters,
): CreateServerReturnType {
  const { host = '::', instance, limit, port } = parameters

  const pool = definePool({ instance, limit })
  const proxy = createProxyServer({
    ignorePath: true,
    ws: true,
  })

  const server = createServer_(async (request, response) => {
    try {
      const url = request.url
      if (!url) {
        response.end()
        return
      }

      const { id, path } = extractPath(url)

      if (typeof id === 'number') {
        if (path === '/') {
          const { host, port } = pool.get(id) || (await pool.start(id))
          return proxy.web(request, response, {
            target: `http://${host}:${port}`,
          })
        }
        if (path === '/destroy') {
          await pool.destroy(id)
          return done(response, 200)
        }
        if (path === '/start') {
          const { host, port } = await pool.start(id)
          return done(response, 200, { host, port })
        }
        if (path === '/stop') {
          await pool.stop(id)
          return done(response, 200)
        }
        if (path === '/restart') {
          await pool.restart(id)
          return done(response, 200)
        }
        if (path === '/messages') {
          const messages = pool.get(id)?.messages.get() || []
          return done(response, 200, messages)
        }
      }

      if (path === '/healthcheck') return done(response, 200)

      return done(response, 404)
    } catch (error) {
      return done(response, 400, { message: (error as Error).message })
    }
  })

  proxy.on('proxyReq', (proxyReq, req) => {
    ;(req as any)._proxyReq = proxyReq
  })

  proxy.on('error', (err, req) => {
    if (req.socket.destroyed && (err as any).code === 'ECONNRESET') {
      ;(req as any)._proxyReq.abort()
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

function done(res: ServerResponse, statusCode: number, json?: unknown) {
  return res
    .writeHead(statusCode, { 'Content-Type': 'application/json' })
    .end(json ? JSON.stringify(json) : undefined)
}
