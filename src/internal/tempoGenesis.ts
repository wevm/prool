/** Sets the Tempo activation schedule without changing genesis allocations. */
export function configureGenesis(genesis: string, hardfork: string): string {
  const value = JSON.parse(genesis) as { config: Record<string, unknown> }
  const forks = Object.keys(value.config)
    .filter((key) => /^t\d+[a-z]*Time$/.test(key))
    .sort((a, b) =>
      a.slice(0, -4).localeCompare(b.slice(0, -4), 'en', { numeric: true }),
    )
  const target = `${hardfork.toLowerCase()}Time`
  const index = forks.indexOf(target)
  if (index === -1)
    throw new Error(
      `Hardfork "${hardfork}" is not present in the Tempo genesis.`,
    )

  for (const [i, fork] of forks.entries()) {
    if (i <= index) value.config[fork] = 0
    else delete value.config[fork]
  }
  return JSON.stringify(value)
}
