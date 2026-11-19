/**
 * Extra host that lets a container reach the Docker host as `host.docker.internal`, also on Linux.
 *
 * @example
 * ```ts
 * new GenericContainer(image).withExtraHosts([Network.hostGateway])
 * ```
 */
export const hostGateway = {
  host: 'host.docker.internal',
  ipAddress: 'host-gateway',
} as const

const loopbackHosts = ['127.0.0.1', '[::1]', 'localhost']

/**
 * Returns `url` as a container reaches it: a loopback host becomes `host.docker.internal`,
 * which {@link hostGateway} resolves to the Docker host. Other URLs are unchanged. The trailing
 * slash of the URL is removed.
 *
 * @example
 * ```ts
 * Network.reachable('http://127.0.0.1:8545/1') // 'http://host.docker.internal:8545/1'
 * ```
 */
export function reachable(url: string): string {
  const value = new URL(url)
  if (loopbackHosts.includes(value.hostname)) value.hostname = hostGateway.host
  return value.href.replace(/\/$/, '')
}
