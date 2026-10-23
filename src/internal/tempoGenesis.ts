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

/** A Tempo genesis, as `tempo dump-genesis` prints it. */
export type Genesis = {
  /** The accounts that the genesis funds or deploys, by address. */
  alloc: Record<string, unknown>
  /** The chain's configuration, such as its chain ID and its hardfork activation times. */
  config: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Returns `genesis` with `hardfork`'s activation schedule, then the changes of `transform`, as the
 * node starts from it.
 */
export function prepareGenesis(
  genesis: string,
  options: prepareGenesis.Options,
): string {
  const { hardfork, transform } = options
  const scheduled =
    hardfork === undefined ? genesis : configureGenesis(genesis, hardfork)
  if (transform === undefined) return scheduled
  return JSON.stringify(transform(JSON.parse(scheduled) as Genesis))
}

export declare namespace prepareGenesis {
  type Options = {
    /** The hardfork to activate at genesis, with every earlier one. */
    hardfork?: string | undefined
    /** Changes the genesis, after `hardfork` applies. */
    transform?: ((genesis: Genesis) => Genesis) | undefined
  }
}
