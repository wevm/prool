# syntax=docker/dockerfile:1
FROM public.ecr.aws/docker/library/rust:1.96.0-trixie AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    git golang-go libclang-dev libssl-dev pkg-config build-essential cmake lld \
    protobuf-compiler libprotobuf-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /source
# The caller supplies a Git build context pinned by config.env.
COPY --from=base-source / /source/
COPY docker/base/devnet.patch /tmp/devnet.patch
RUN git apply --check /tmp/devnet.patch && git apply /tmp/devnet.patch
COPY docker/base/fixture.rs /source/etc/systems/src/prool_fixture.rs
COPY docker/base/prepare-fixture.rs /source/etc/systems/src/bin/prool-prepare-fixture.rs
ENV CARGO_INCREMENTAL=0 CARGO_PROFILE_RELEASE_LTO=false
ENV RUSTFLAGS="-C link-arg=-fuse-ld=lld"
ARG BUILD_JOBS=4
# Disabling upgrade-signal avoids the unrelated Foundry contract build.
RUN --mount=type=cache,id=prool-base-devnet-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=prool-base-devnet-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=prool-base-devnet-target,target=/source/target,sharing=locked \
    cargo build --locked --release --jobs "$BUILD_JOBS" \
      --package base-system-tests --bin base-devnet --bin prool-prepare-fixture --no-default-features && \
    install -Dm755 target/release/base-devnet /out/base-devnet && \
    PROOL_BASE_FIXTURE=1 target/release/prool-prepare-fixture /out/fixture
RUN tar --sparse -czf /out/fixture.tar.gz -C /out/fixture .

FROM public.ecr.aws/docker/library/debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libssl3t64 libstdc++6 curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /out/base-devnet /usr/local/bin/base-devnet
COPY --from=builder /out/fixture.tar.gz /opt/base/fixture.tar.gz
COPY --chmod=755 docker/base/entrypoint.sh /usr/local/bin/prool-base
COPY --from=base-source /LICENSE /usr/share/doc/base-devnet/LICENSE
WORKDIR /run/base
# Only public HTTP RPCs are exposed. Engine APIs remain on container loopback.
EXPOSE 7545 8545
STOPSIGNAL SIGINT
ENV PROOL_BASE_FIXTURE=1
ENTRYPOINT ["prool-base"]
CMD ["snapshot", "--stable-ports", "--builder-datadir", "/data/builder", "--client-datadir", "/data/client", "--runtime-file", "/run/base/runtime.json"]
