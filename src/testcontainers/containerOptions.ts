import { type ImagePullPolicy, PullPolicy } from 'testcontainers'

export const defaults = {
  startupTimeout: 10_000,
} as const

export type Parameters = {
  /**
   * Pull policy for the instance's images.
   *
   * Pass `PullPolicy.defaultPolicy()` to reuse a local or pre-pulled image.
   *
   * @default PullPolicy.alwaysPull()
   */
  pullPolicy?: ImagePullPolicy | undefined
  /**
   * Startup timeout (in milliseconds) for testcontainers readiness checks.
   *
   * Increase this when running in CI or environments with slow image pulls.
   *
   * @default 10_000
   */
  startupTimeout?: number | undefined
}

export function resolvePullPolicy(
  pullPolicy: ImagePullPolicy | undefined,
): ImagePullPolicy {
  return pullPolicy ?? PullPolicy.alwaysPull()
}

export function resolveStartupTimeout(
  startupTimeout: number | undefined,
): number {
  return startupTimeout ?? defaults.startupTimeout
}
