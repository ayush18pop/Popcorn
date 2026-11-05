#!/usr/bin/env bash
# Creates a throwaway test key at keys/<name>.json in the format the examples and tests read: [{address, private_key}].
# Never use these keys for anything of value. keys/ is git-ignored.
#   scripts/new-key.sh deployer
set -euo pipefail
name="${1:?usage: scripts/new-key.sh <name>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/keys"
f="$root/keys/$name.json"
[[ -e "$f" ]] && { echo "$f exists" >&2; exit 1; }
command -v cast >/dev/null || { echo "cast (Foundry) not found" >&2; exit 1; }
json="$(cast wallet new --json)"
(umask 077; printf '%s\n' "$json" | python3 -c 'import json,sys; k=json.load(sys.stdin); k=k.get("data", k); k=k[0] if isinstance(k,list) else k; print(json.dumps([{"address":k["address"],"private_key":k["private_key"]}]))' > "$f")
python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0]["address"])' "$f"
