#!/usr/bin/env bash
# Builds the Open Sponsor payer contract with the same solc as Core (scripts/install-solc.sh).
#   contracts/sponsor/out/OpenSponsor.bin  creation code (append owner, period, maxFee, defaultLimit as 4 x 32 bytes)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
SOLC="${SOLC:-${SVM_HOME:-$HOME/.local/share/svm}/0.8.33/solc-0.8.33}"
[[ -x "$SOLC" ]] || { echo "solc not found at $SOLC; run scripts/install-solc.sh" >&2; exit 1; }
mkdir -p "$here/out"
bin="$("$SOLC" --strict-assembly --optimize --evm-version prague --bin "$here/OpenSponsor.yul" | awk '/^Binary representation:/{getline; print}')"
[[ -n "$bin" ]] || { echo "compile failed" >&2; exit 1; }
printf '%s\n' "$bin" > "$here/out/OpenSponsor.bin"
echo "creation $(( ${#bin} / 2 )) bytes -> $here/out/OpenSponsor.bin"
