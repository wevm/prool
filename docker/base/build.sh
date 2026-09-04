#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
project_dir=$(cd -- "$script_dir/../.." && pwd)
source "$script_dir/config.env"

# Build a synthetic one-block snapshot. No registry push.
docker buildx build --load \
  --platform "${PLATFORM:-linux/amd64}" \
  --tag "prool-base-localnet:$BASE_REVISION" \
  --build-context "base-source=https://github.com/base/base.git#$BASE_REVISION" \
  --build-arg "BUILD_JOBS=${BUILD_JOBS:-4}" \
  --file "$script_dir/Dockerfile" \
  "$project_dir"

docker run --rm --platform "${PLATFORM:-linux/amd64}" "prool-base-localnet:$BASE_REVISION" snapshot --help
