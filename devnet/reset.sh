#!/usr/bin/env bash
# Stops everything and wipes devnet/data (chain, beacon, validator, sidecar mempool, explorer build).
# Keeps devnet/keys. The next devnet/up.sh starts a fresh chain from a new genesis.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/env.sh"
"$here/down.sh" || true
if [[ -d "$DATA" ]]; then
  # the containers write as root; delete through a container instead of needing sudo
  docker run --rm -v "$DATA":/wipe --entrypoint sh ethpandaops/ethereum-genesis-generator:6.1.6 -c 'rm -rf /wipe/* /wipe/.[!.]* 2>/dev/null; true'
  rmdir "$DATA" 2>/dev/null || rm -rf "$DATA"
fi
echo "local devnet data wiped ($DATA)"
