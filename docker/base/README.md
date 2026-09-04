# Base Localnet

L1-free Base node, chain ID `8453`, with a bundled synthetic snapshot.
Not a mainnet fork. No L1 settlement or advancing safe/finalized heads.

## Build

Requires Docker Buildx. Builds locally without publishing.

```sh
bash docker/base/build.sh                          # AMD64, 4 compiler jobs
BUILD_JOBS=2 bash docker/base/build.sh              # Lower parallelism
PLATFORM=linux/arm64 bash docker/base/build.sh       # Native ARM64
```

Output: `prool-base-localnet:<BASE_REVISION>`, pinned by `config.env`.
First build takes several minutes. AMD64 on ARM requires Docker emulation.

## Usage

Set `FUNDER_ADDRESS` to a throwaway account.

```sh
source docker/base/config.env
docker run --rm --platform linux/amd64 --name prool-base-localnet \
  -p 127.0.0.1:7545:7545 -p 127.0.0.1:8545:8545 \
  "prool-base-localnet:$BASE_REVISION" \
  snapshot --stable-ports \
  --builder-datadir /data/builder --client-datadir /data/client \
  --block-interval 200ms --prefund-address "${FUNDER_ADDRESS:?Set a throwaway address}" \
  --runtime-file /run/base/runtime.json
```

In another terminal:

```sh
docker exec prool-base-localnet cat /run/base/runtime.json
docker stop --time 30 prool-base-localnet
```

## Tests

Requires Docker and the image. Tests cover transfers, EIP-8130 storage writes,
and nonce-channel isolation on builder/client RPCs.

```sh
pnpm test --run
pnpm test --run src/testcontainers/instances/base.test.ts
```

Both RPCs support `eth_getTransactionCount(address, block, nonceKey)`.
Omitting the key or passing zero returns the protocol nonce; other keys return
independent channel counters. `U256::MAX` returns `INVALID_PARAMS`.

## Publishing

`main.yml` runs **Release images** after verification, publishing AMD64 to:

```text
ghcr.io/<owner>/prool-base-localnet:sha-<prool-commit>
```

Uses `GITHUB_TOKEN`; no registry secret. The workflow summary includes the digest.
Verification tests an existing image, not the current Docker changes.

First release requires a separate publish. Make the package public, then set:

```text
Repository variable:
BASE_IMAGE=ghcr.io/wevm/prool-base-localnet@sha256:<published-digest>
```

CI pulls and tags that image locally for `Instance.base()`. Until its default is
updated to a GHCR digest, local usage still requires a build.

## Upstream TODO

Changes needed in Base to replace our custom image:

- [ ] Ship `base-devnet` in an official Docker image.
- [ ] Support L1-free startup with bundled minimal state, without external snapshots.
- [ ] Expose chain and fork configuration, including Cobalt/EIP-8130 activation.
- [ ] Make builder/client HTTP bind addresses configurable for Docker. Keep Engine APIs private.
- [ ] Register the EIP-8130 RPC extension in the in-process devnet launchers.

Once available, pin the official image in `Instance.base()` and remove the custom
Dockerfile, fixture generation, and `devnet.patch`.
