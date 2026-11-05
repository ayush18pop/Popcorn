#!/usr/bin/env bash
# Replays the organisers' mainnet contract library (deploy/predeploy in the sidecar repo) onto the LOCAL chain,
# from the same published deployer key starting at nonce 0 in the same order, so every contract lands at the
# public devnet's address. NaiveStakingRegistry (the last protocol, deployer nonce 124 on the public devnet) is
# not replayed: it is preloaded in genesis at the same address (see genesis.values.env).
#
# The tool runs from a copy in data/predeploy-tool, so its journal (addresses/1338.json) never touches the
# sidecar checkout. Idempotent: the tool skips protocols already deployed; data/predeploy.done marks success.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/env.sh"
if [[ -f "$DATA/predeploy.done" ]]; then echo "[predeploy] contract library already replayed"; exit 0; fi
if [[ -f "$DATA/predeploy.pid" ]] && kill -0 "$(cat "$DATA/predeploy.pid")" 2>/dev/null; then
  echo "[predeploy] already running (pid $(cat "$DATA/predeploy.pid"), log $DATA/predeploy.log)"; exit 0
fi
echo $$ > "$DATA/predeploy.pid"
trap 'rm -f "$DATA/predeploy.pid"' EXIT

# Never let the tool fall back to its default RPC (the public devnet).
id="$(curl -s -m 5 "$RPC_URL" -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}')"
[[ "$id" == *'"0x53a"'* ]] || { echo "[predeploy] $RPC_URL is not chain 1338: $id" >&2; exit 1; }

tool="$DATA/predeploy-tool"
src="$SIDECAR_DIR/deploy/predeploy"
[[ -d "$src" ]] || { echo "[predeploy] $src not found" >&2; exit 1; }
mkdir -p "$tool"
# copy everything except the public journal and node_modules
(cd "$src" && tar --exclude=./node_modules --exclude=./addresses -cf - .) | (cd "$tool" && tar -xf -)
[[ -d "$tool/node_modules" ]] || (cd "$tool" && bun install --frozen-lockfile >/dev/null 2>&1 || bun install >/dev/null)

protocols=(link usdt bayc tornado usdc weth9 permit2 uniswap-v4 uniswap-v4-periphery railgun)
echo "[predeploy] replaying ${protocols[*]} (about 110 transactions, one per block)"
(cd "$tool" && PREDEPLOY_RPC_URL="$RPC_URL" bun run src/cli.ts run "${protocols[@]}")

# Compare with the public devnet's recorded addresses.
python3 - "$src/addresses/1337.json" "$tool/addresses/1338.json" <<'PY'
import json, sys
pub, loc = (json.load(open(f))["protocols"] for f in sys.argv[1:3])
bad = 0
for name, p in loc.items():
    for c, a in p["contracts"].items():
        want = pub.get(name, {}).get("contracts", {}).get(c)
        ok = want is not None and want.lower() == a.lower()
        bad += not ok
        print(f"  {name}/{c}: {a} {'== public' if ok else f'!= public {want}'}")
sys.exit(1 if bad else 0)
PY
touch "$DATA/predeploy.done"
echo "[predeploy] done; every address matches the public devnet"
