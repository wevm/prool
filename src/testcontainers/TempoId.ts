/** An app that Tempo ID registers at its start, as an entry of `ID_DEV_APPS`. */
export type App = {
  /** URL that receives a logout token for each session of the app that ends at Tempo ID. */
  backchannelLogoutUri?: string | undefined
  /** Whether the app's backend signs users in with an emailed code. Needs `clientSecret` or `jwks`. */
  backendSignIn?: boolean | undefined
  /** Client ID, of 8 to 64 letters, digits, `-`, or `_`. */
  clientId: string
  /** A backend's client secret, of at least 32 characters. Without it and `jwks`, the app is public. */
  clientSecret?: string | undefined
  /** Whether each token request of the app must send a DPoP proof. */
  dpop?: boolean | undefined
  /** First Tempo Account of the app's new users. @default "server" */
  firstAccount?: 'passkey' | 'server' | undefined
  /** Whether the app holds `tempo-id:iframe`, so its dialog trusts the page that frames it. */
  iframe?: boolean | undefined
  /** Public keys of the app's client assertions, each with a `kid`. Excludes `clientSecret`. */
  jwks?: { keys: readonly JsonWebKey[] } | undefined
  /** Name that the approval page shows. */
  name: string
  /** Realms that the app reaches. @default ["default"] */
  realms?: readonly string[] | undefined
  /** Redirect URIs, which may use `http` and a loopback host. */
  redirectUris: readonly string[]
  /** Lifetime of each refresh token, in seconds. @default 30 days */
  refreshTokenLifetime?: number | 'never' | undefined
  /** Whether the app holds `tempo-id:sign`. */
  sign?: boolean | undefined
}

/** A registered resource (an API that an app names as `resource`), as an entry of `ID_DEV_RESOURCES`. */
export type Resource = {
  /** Identifier that a request names as `resource`: an `https` URI that no request reaches. */
  identifier: string
  /** Name that the approval page shows. */
  name: string
  /** Access key policy. Without it, the resource issues only access tokens. */
  policy?: Policy | undefined
  /** Scopes that a token for the resource may grant. @default every scope */
  scopes?: readonly string[] | undefined
}

/** Access key policy of a {@link Resource}: what each access key of the API may do. */
export type Policy = {
  /**
   * URL that Tempo ID requests each access key's public key from at an approval. Tempo ID posts
   * from inside the container, so a host service names `host.docker.internal`. Without it, the
   * API redeems each allowance itself.
   */
  accessKeyEndpoint?: string | undefined
  /** Chain of each access key. @default Tempo mainnet */
  chainId?: number | undefined
  /** App of `ID_DEV_APPS` that the API authenticates as. */
  clientId: string
  /** Seconds from an approval until its access key expires, at most one year. */
  lifetime: number
  /** Spending limits. */
  limits: readonly {
    /** Amount in the token's base units, as hex. */
    limit: `0x${string}`
    /** Seconds after which the limit resets. Without it, the limit is a one-time total. */
    period?: number | undefined
    /** Token address. */
    token: `0x${string}`
  }[]
  /** Calls that each access key may make. */
  scopes: readonly {
    /** Contract address. */
    address: `0x${string}`
    /** Only recipients or spenders the call may name. Without it, any. */
    recipients?: readonly `0x${string}`[] | undefined
    /** Function selector. Without it, any function. */
    selector?: `0x${string}` | undefined
  }[]
}

/**
 * Returns the latest sign-in code that an `id-dev` instance's inbox holds for `email`, or
 * `undefined` until it arrives.
 *
 * @example
 * ```ts
 * const code = await TempoId.code({ email: 'alice@example.org', url: tempoId.url })
 * ```
 */
export async function code(options: code.Options): Promise<string | undefined> {
  const { email, url } = options
  const response = await fetch(
    `${new URL(url).origin}/__id-dev/code?${new URLSearchParams({ email })}`,
  )
  if (response.status === 404) {
    await response.body?.cancel()
    return undefined
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      `Reading the sign-in code from ${url} responded with ${response.status}. Is it an \`id-dev\` instance?`,
    )
  }
  const body = (await response.json()) as { code: string }
  return body.code
}

export declare namespace code {
  type Options = {
    /** Address that received the code. */
    email: string
    /** URL of the `id-dev` instance. */
    url: string
  }
}

/** Returns whether the `id-dev` instance at `url` answers its health check. */
export async function healthy(url: string): Promise<boolean> {
  const response = await fetch(`${new URL(url).origin}/__id-dev/health`, {
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
  await response?.body?.cancel()
  return response?.status === 204
}
