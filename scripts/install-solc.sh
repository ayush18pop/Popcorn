#!/usr/bin/env bash
# Installs solc 0.8.33 (static linux-amd64 build) into the svm cache that forge also uses,
# verifies its sha256 against binaries.soliditylang.org, and checks that
# `--strict-assembly` accepts `verbatim`. Prints the path to use as $SOLC.
set -euo pipefail

VERSION=0.8.33
BUILD="solc-linux-amd64-v0.8.33+commit.64118f21"
SHA256=1274e5c4621ae478090c5a1f48466fd3c5f658ed9e14b15a0b213dc806215468
DIR="${SVM_HOME:-$HOME/.local/share/svm}/$VERSION"
BIN="$DIR/solc-$VERSION"

if [[ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]]; then
  echo "this script only knows the linux-amd64 build; on macOS use: forge build --use $VERSION (svm) or brew" >&2
  exit 1
fi

if [[ ! -x "$BIN" ]] || ! echo "$SHA256  $BIN" | sha256sum -c --quiet - 2>/dev/null; then
  mkdir -p "$DIR"
  tmp="$(mktemp)"
  curl -fsSL "https://binaries.soliditylang.org/linux-amd64/$BUILD" -o "$tmp"
  echo "$SHA256  $tmp" | sha256sum -c --quiet -
  install -m 0755 "$tmp" "$BIN"
  rm -f "$tmp"
fi

"$BIN" --version | tail -1

# Smoke test: a Yul object using verbatim (APPROVE 0xaa with 3 stack inputs, 0 outputs).
t="$(mktemp --suffix=.yul)"
cat > "$t" <<'YUL'
object "T" {
  code { datacopy(0, dataoffset("r"), datasize("r")) return(0, datasize("r")) }
  object "r" { code { verbatim_3i_0o(hex"aa", 0, 0, 3) } }
}
YUL
out="$("$BIN" --strict-assembly --bin "$t" | tail -1)"
rm -f "$t"
case "$out" in
  *aa*) echo "verbatim ok: $out" ;;
  *) echo "verbatim smoke test failed: $out" >&2; exit 1 ;;
esac
echo "SOLC=$BIN"
