#!/usr/bin/env bash
# DEVELOPMENT trusted setup for the membership, withdraw and stealth circuits. NOT a production ceremony.
#
# Phase 1: the public Hermez "powersOfTau28_hez_final_15" (2^15 constraints; the largest circuit, withdraw, has 21,836),
#          checked with `snarkjs powersoftau verify` (the whole contribution transcript) and pinned by sha256 below.
# Phase 2: one circuit-specific contribution made on this machine with fresh randomness, then a beacon. Anyone who knows
#          that contribution's randomness can forge proofs for that circuit, so these keys are for the devnets. A
#          production deployment needs a multi-party phase 2.
#   bash scripts/setup.sh [circuit ...]       (default: membership withdraw stealth; --force redoes existing keys)
set -euo pipefail
cd "$(dirname "$0")/.."
SNARKJS="node node_modules/snarkjs/build/cli.cjs"
PTAU=setup/powersOfTau28_hez_final_15.ptau
PTAU_URL=https://circom.info/powersOfTau28_hez_final_15.ptau
PTAU_SHA256=3ef2ecc5b75d687048cf2d59195119b42fb07c5af639c5f283d84bfa69829e7f
FORCE=0; ARGS=()
for a in "$@"; do [[ "$a" == --force ]] && FORCE=1 || ARGS+=("$a"); done
[[ ${#ARGS[@]} -gt 0 ]] || ARGS=(membership withdraw stealth)

[[ -f "$PTAU" ]] || curl -fL --retry 3 -o "$PTAU" "$PTAU_URL"
[[ "$(sha256sum "$PTAU" | cut -d' ' -f1)" == "$PTAU_SHA256" ]] || { echo "ptau sha256 mismatch" >&2; exit 1; }
if [[ ! -f setup/.ptau-verified ]]; then
  $SNARKJS powersoftau verify "$PTAU" | tail -3
  touch setup/.ptau-verified
fi

for c in "${ARGS[@]}"; do
  [[ -f build/$c.r1cs ]] || bash scripts/build.sh "$c"
  if [[ $FORCE == 0 && -f setup/${c}_final.zkey ]]; then
    echo "setup/${c}_final.zkey exists; --force redoes phase 2 (changes the verifying key)"
  else
    $SNARKJS groth16 setup build/$c.r1cs "$PTAU" build/${c}_0000.zkey >/dev/null
    ENTROPY=$(head -c 64 /dev/urandom | xxd -p | tr -d '\n')
    $SNARKJS zkey contribute build/${c}_0000.zkey build/${c}_0001.zkey --name="popcorn development contribution" -e="$ENTROPY" >/dev/null
    unset ENTROPY
    BEACON=$(sha256sum build/$c.r1cs | cut -d' ' -f1)
    $SNARKJS zkey beacon build/${c}_0001.zkey setup/${c}_final.zkey "$BEACON" 10 -n="popcorn beacon (sha256 of the r1cs)" >/dev/null
    rm -f build/${c}_0000.zkey build/${c}_0001.zkey
  fi
  $SNARKJS zkey verify build/$c.r1cs "$PTAU" setup/${c}_final.zkey | tail -1
  $SNARKJS zkey export verificationkey setup/${c}_final.zkey setup/${c}_vkey.json >/dev/null
done
sha256sum "$PTAU" setup/*_final.zkey setup/*_vkey.json > setup/SHA256SUMS
cat setup/SHA256SUMS
