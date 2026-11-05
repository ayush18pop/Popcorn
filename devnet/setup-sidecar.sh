#!/usr/bin/env bash
# Builds the sidecar the local devnet runs: the workshop sidecar at a pinned commit plus patches/per-entity-budgets.patch
# (ERC-8421 BUDGET-010: a validation budget per entity, 250,000 unstaked / 2,500,000 staked).
#
#   devnet/setup-sidecar.sh          clone, patch, install and build into devnet/data/sidecar (idempotent)
#
# Environment:
#   SIDECAR_DIR   where to build it (default devnet/data/sidecar)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/env.sh"

UPSTREAM="https://github.com/forshtat/mempool-workshop-sidecar"
COMMIT="2e22ff0a2898e69ea4bf5275bce1be8581a8582a"
PATCH="$here/patches/per-entity-budgets.patch"
log() { printf '\033[1m[sidecar]\033[0m %s\n' "$*"; }

for bin in git bun; do command -v "$bin" >/dev/null || { echo "$bin not found" >&2; exit 1; }; done

if [[ -f "$SIDECAR_DIR/.patched" && -f "$SIDECAR_DIR/packages/cli/lib/cli.js" ]]; then
  log "already built at $SIDECAR_DIR"
  exit 0
fi

if [[ ! -d "$SIDECAR_DIR/.git" ]]; then
  log "cloning $UPSTREAM"
  mkdir -p "$(dirname "$SIDECAR_DIR")"
  git clone -q "$UPSTREAM" "$SIDECAR_DIR"
fi
cd "$SIDECAR_DIR"
git checkout -q "$COMMIT"
if ! git apply --check "$PATCH" 2>/dev/null; then
  # already applied (an earlier run stopped before the build): nothing to do
  git apply --check --reverse "$PATCH" 2>/dev/null || { echo "patch does not apply at $COMMIT" >&2; exit 1; }
else
  log "applying per-entity-budgets.patch"
  git apply "$PATCH"
fi
log "installing and building (a few minutes)"
bun install >/dev/null
bun run build >/dev/null
touch .patched
log "done: $SIDECAR_DIR"
