import {
  createServer as createServer_,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import httpProxy from 'http-proxy'
import { extractPath } from './internal/utils.js'
import * as Pool from './Pool.js'

const { createProxyServer } = httpProxy

export type CreateServerParameters = Pool.define.Parameters<number> &
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
 * import { Instance, Server } from 'prool'
 *
 * const server = Server.create({
 *  instance: Instance.anvil(),
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
export function create(
  parameters: CreateServerParameters,
): CreateServerReturnType {
  const { host = '::', instance, limit, port } = parameters

  const pool = Pool.define({ instance, limit })
  const proxy = createProxyServer({
    ignorePath: true,
    ws: true,
  })

  const server = createServer_(async (request, response) => {
    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        })
        response.end()
        return
      }

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

  proxy.on('proxyRes', (proxyRes) => {
    proxyRes.headers['Access-Control-Allow-Origin'] = '*'
    proxyRes.headers['Access-Control-Allow-Methods'] =
      'GET, POST, PUT, DELETE, OPTIONS'
    proxyRes.headers['Access-Control-Allow-Headers'] =
      'Content-Type, Authorization'
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
    .writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    .end(json ? JSON.stringify(json) : undefined)
}
