#!/bin/sh
set -eu

if [ "${PROOL_BASE_FIXTURE:-0}" = 1 ]; then
  # Both copies belong to this container. Never overwrite an existing database.
  test ! -e /data/builder
  test ! -e /data/client
  mkdir -p /data/builder /data/client
  tar -xzf /opt/base/fixture.tar.gz -C /data/builder
  tar -xzf /opt/base/fixture.tar.gz -C /data/client
fi

exec base-devnet "$@"
