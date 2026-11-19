---
"prool": minor
---

Added the pieces of a Tempo end-to-end stack:

- `Server.create` takes `ready` (start instances in `start()` and wait until they answer `eth_chainId`, optionally on a chain ID, with a timeout) and `url` (check a running instance instead of serving one). Keyed servers have `url(id)`.
- `prool/playwright` exports `Setup.define`, a Playwright global setup that starts services in order, rolls back on failure, sets environment variables, and returns the teardown.
- `prool/testcontainers` exports `Instance.tempoId` for the `id-dev` image (apps, resources, `RPC_URLS`, fixed host port, health wait, or an external `url`), `TempoId.code()`, `Network.reachable()`, `Network.hostGateway`, and `Images.pulled()`.
- Container instances take a `pullPolicy` (default unchanged: always pull).
- The Tempo container instance funds OUSD (`0x20c0000000000000000000006a37da5c996874be`) by default on its default image, whose dev genesis holds it. The typed `faucet.addresses` option is now `faucet.address`, matching the `--faucet.address` flag.
