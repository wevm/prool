export const defaults = {
  startupTimeout: 10_000,
} as const

export type Parameters = {
  /**
   * Startup timeout (in milliseconds) for testcontainers readiness checks.
   *
   * Increase this when running in CI or environments with slow image pulls.
   *
   * @default 10_000
   */
  startupTimeout?: number | undefined
}

export function resolveStartupTimeout(
  startupTimeout: number | undefined,
): number {
  return startupTimeout ?? defaults.startupTimeout
}
