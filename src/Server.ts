import {
  createServer as createServer_,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import httpProxy from 'http-proxy'
import type { Endpoint, Instance } from './Instance.js'
import { extractPath } from './internal/utils.js'
import * as Pool from './Pool.js'

const { createProxyServer } = httpProxy
const websocketProtocols: Partial<Record<Endpoint.Protocol, 'ws' | 'wss'>> = {
  http: 'ws',
  https: 'wss',
  ws: 'ws',
  wss: 'wss',
}

type AddressParameters = {
  /** Host to run the server on. */
  host?: string | undefined
  /** Port to run the server on. */
  port?: number | undefined
}

export type CreateServerParameters<instance extends Instance = Instance> =
  Pool.define.Parameters<number, instance> &
    AddressParameters & {
      /**
       * Waits in `start()` until instances answer `eth_chainId`. Without it, `start()` only
       * listens, and each instance starts on its first request.
       */
      ready?: ReadyParameters | undefined
      /**
       * URL of a running instance to use instead. When set, `start()` neither listens nor starts
       * an instance, and only waits until the URL answers `eth_chainId`.
       */
      url?: string | undefined
    }

export type ReadyParameters = {
  /** Chain ID that each instance must serve. */
  chainId?: number | undefined
  /**
   * Instance IDs to start and wait for. Ignored with `url`.
   * @default [1]
   */
  ids?: readonly number[] | undefined
  /**
   * Longest wait, in milliseconds.
   * @default 300_000, or 10_000 with `url`
   */
  timeout?: number | undefined
}

export type CreateLeaseServerParameters<instance extends Instance = Instance> =
  {
    /** Exclusively leased instance pool. */
    pool: Pool.LeasePool<instance>
  } & AddressParameters

export type CreateLeaseServerReturnType = Omit<
  Server<typeof IncomingMessage, typeof ServerResponse>,
  'address'
> & {
  address(): AddressInfo | null
  start(): Promise<() => Promise<void>>
  stop(): Promise<void>
}

export type CreateServerReturnType = CreateLeaseServerReturnType & {
  /**
   * Returns the URL of instance `id` (`http://host:port/id`), or the server's URL without `id`.
   * With `url`, returns that URL for any `id`.
   */
  url(id?: number | undefined): string
}

/**
 * Creates a server for a keyed instance proxy or an exclusive lease pool.
 *
 * @example
 * ```
 * import { Instance, Pool, Server } from 'prool'
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
 *
 * const pool = Pool.create({ instance: Instance.anvil(), limit: 2 })
 * const leaseServer = Server.create({ pool })
 * await leaseServer.start()
 * // POST /acquire, then POST /release/:token.
 * ```
 */
export function create<instance extends Instance = Instance>(
  parameters: CreateServerParameters<instance>,
): CreateServerReturnType
export function create<instance extends Instance = Instance>(
  parameters: CreateLeaseServerParameters<instance>,
): CreateLeaseServerReturnType
export function create<instance extends Instance = Instance>(
  parameters:
    | CreateLeaseServerParameters<instance>
    | CreateServerParameters<instance>,
): CreateServerReturnType | CreateLeaseServerReturnType {
  if ('pool' in parameters) return createLeaseServer(parameters)

  const { host, instance, limit, port, ready, url: external } = parameters

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
          const instance = pool.get(id) || (await pool.start(id))
          return proxy.web(request, response, {
            target: httpProxyTarget(instance.endpoints.default),
          })
        }
        if (path === '/destroy') {
          await pool.destroy(id)
          return done(response, 200)
        }
        if (path === '/start') {
          const instance = await pool.start(id)
          return done(response, 200, instanceDescriptor(instance))
        }
        if (path === '/stop') {
          await pool.stop(id)
          return done(response, 200)
        }
        if (path === '/restart') {
          await pool.restart(id)
          const instance = pool.get(id)
          return done(
            response,
            200,
            instance ? instanceDescriptor(instance) : undefined,
          )
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
      try {
        const instance = pool.get(id) || (await pool.start(id))
        proxy.ws(request, socket, head, {
          target: websocketProxyTarget(instance.endpoints.default),
        })
      } catch (error) {
        socket.destroy(
          error instanceof Error ? error : new Error(String(error)),
        )
      }
      return
    }

    socket.destroy(new Error('Unsupported request'))
    return
  })

  return Object.assign(server as any, {
    async start() {
      if (external) {
        const { chainId, timeout = 10_000 } = ready ?? {}
        await waitUntilReady([external], { chainId, timeout })
        return this.stop
      }
      await new Promise<void>((resolve) => {
        if (host !== undefined || port !== undefined)
          server.listen(port ?? 0, host ?? '::', resolve)
        else server.listen(resolve)
      })
      if (!ready) return this.stop
      const { chainId, ids = [1], timeout = 300_000 } = ready
      try {
        await waitUntilReady(
          ids.map((id) => this.url(id)),
          { chainId, timeout },
          // Starts each instance directly, so a failed start rejects at once.
          ids.map((id) => () => pool.start(id)),
        )
      } catch (error) {
        await this.stop().catch(() => {})
        throw error
      }
      return this.stop
    },
    async stop() {
      if (!server.listening) return
      await settle([
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
        pool.destroyAll(),
      ])
    },
    url(id?: number) {
      if (external) return external
      const address = server.address() as AddressInfo | null
      if (!address) throw new Error('Server is not listening.')
      const hostname = ['::', '0.0.0.0'].includes(address.address)
        ? '127.0.0.1'
        : address.address.includes(':')
          ? `[${address.address}]`
          : address.address
      return `http://${hostname}:${address.port}${id === undefined ? '' : `/${id}`}`
    },
  })
}

function createLeaseServer<instance extends Instance = Instance>(
  parameters: CreateLeaseServerParameters<instance>,
): CreateLeaseServerReturnType {
  const { host, pool, port } = parameters
  const leases = new Map<string, Pool.Lease<instance>>()
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

      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (request.method === 'POST' && path === '/acquire') {
        let disconnected = false
        let lease: Pool.Lease<instance> | undefined
        let token: string | undefined
        function release() {
          disconnected = true
          if (!lease) return
          if (token) leases.delete(token)
          void lease.release().catch(() => {})
        }
        request.once('aborted', release)
        response.once('close', () => {
          if (!response.writableFinished) release()
        })
        lease = await pool.acquire()
        if (disconnected || request.destroyed || response.destroyed) {
          await lease.release()
          return
        }
        token = crypto.randomUUID()
        leases.set(token, lease)
        return done(response, 200, {
          ...instanceDescriptor(lease.instance),
          token,
        })
      }
      if (request.method === 'POST' && path.startsWith('/release/')) {
        const token = path.slice('/release/'.length)
        const lease = leases.get(token)
        if (!lease) return done(response, 404)
        leases.delete(token)
        await lease.release()
        return done(response, 204)
      }
      if (path === '/healthcheck') return done(response, 200)
      return done(response, 404)
    } catch (error) {
      if (response.destroyed) return
      return done(response, 400, { message: (error as Error).message })
    }
  })

  return Object.assign(server as any, {
    start() {
      return new Promise<() => Promise<void>>((resolve) => {
        if (host !== undefined || port !== undefined)
          server.listen(port ?? 0, host ?? '::', () => resolve(this.stop))
        else server.listen(() => resolve(this.stop))
      })
    },
    async stop() {
      try {
        await settle([
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
          pool.close(),
        ])
      } finally {
        leases.clear()
      }
    },
  })
}

/**
 * Waits until every URL answers `eth_chainId`, with `chainId` when set. Runs each `start` first.
 * Rejects at `timeout`, at a failed start, or when an instance serves another chain.
 */
async function waitUntilReady(
  urls: readonly string[],
  options: { chainId: number | undefined; timeout: number },
  starts: readonly (() => Promise<unknown>)[] = [],
) {
  const { chainId, timeout } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    await Promise.all(
      urls.map(async (url, index) => {
        let last = 'no response'
        const timedOut = () =>
          new Error(
            `Instance at ${url} did not answer \`eth_chainId\` within ${timeout}ms (last: ${last}).`,
          )
        const aborted = new Promise<never>((_, reject) => {
          if (controller.signal.aborted) reject(timedOut())
          controller.signal.addEventListener('abort', () => reject(timedOut()))
        })
        aborted.catch(() => {})
        const start = starts[index]
        if (start) await Promise.race([start(), aborted])
        while (!controller.signal.aborted) {
          const response = await fetch(url, {
            body: JSON.stringify({
              id: 1,
              jsonrpc: '2.0',
              method: 'eth_chainId',
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(5_000),
            ]),
          }).catch((error: Error) => {
            last = error.message
            return undefined
          })
          const body = response
            ? await response
                .text()
                .then((text) => {
                  last = `${response.status} ${text}`
                  return JSON.parse(text) as { result?: string | undefined }
                })
                .catch(() => undefined)
            : undefined
          if (response?.ok && typeof body?.result === 'string') {
            const id = Number(body.result)
            if (chainId === undefined || id === chainId) return
            throw new Error(
              `Instance at ${url} serves chain ${id}, not chain ${chainId}.`,
            )
          }
          await Promise.race([
            new Promise((resolve) => setTimeout(resolve, 500)),
            aborted,
          ])
        }
        throw timedOut()
      }),
    )
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

function httpProxyTarget(endpoint: Endpoint) {
  if (endpoint.protocol !== 'http' && endpoint.protocol !== 'https')
    throw new Error(`Cannot proxy ${endpoint.protocol} endpoint over HTTP.`)
  return `${endpoint.protocol}://${endpoint.host}:${endpoint.port}`
}

function websocketProxyTarget(endpoint: Endpoint) {
  const protocol = websocketProtocols[endpoint.protocol]
  if (!protocol)
    throw new Error(
      `Cannot proxy ${endpoint.protocol} endpoint over WebSocket.`,
    )
  return `${protocol}://${endpoint.host}:${endpoint.port}`
}

function instanceDescriptor(
  instance: Pick<Instance, 'endpoints' | 'host' | 'port' | 'url'>,
) {
  return {
    endpoints: instance.endpoints,
    host: instance.host,
    port: instance.port,
    url: instance.url,
  }
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

async function settle(promises: readonly Promise<unknown>[]) {
  const errors: unknown[] = []
  for (const result of await Promise.allSettled(promises))
    if (result.status === 'rejected') errors.push(result.reason)
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'Server stop failed.')
}
