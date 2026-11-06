#!/usr/bin/env bash
# Compiles every circuit in circuits/ (except libraries) to build/<name>.r1cs and build/<name>_js/<name>.wasm.
set -euo pipefail
cd "$(dirname "$0")/.."
CIRCOM="${CIRCOM:-$HOME/.local/bin/circom}"
mkdir -p build
for c in ${@:-exploit membership withdraw stealth}; do
  "$CIRCOM" "circuits/$c.circom" --r1cs --wasm --sym -o build >/dev/null
  printf '%-12s %s constraints\n' "$c" "$(node node_modules/snarkjs/build/cli.cjs r1cs info build/$c.r1cs 2>/dev/null | awk '/# of Constraints/{print $NF}')"
done
