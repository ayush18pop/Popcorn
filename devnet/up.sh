#!/usr/bin/env bash
# One command for the local EIP-8141 devnet (see devnet/README.md). Idempotent: re-running skips
# whatever is already up.
#
#   genesis (if missing) -> ethrex + 2x Lighthouse beacon + validator -> wait for blocks (and Hegota)
#   -> predeploys -> patched sidecar (standalone, auto bundling) -> devnet-ui explorer -> RuleFactory
#
# Environment:
#   SIDECAR_DIR            patched sidecar checkout (default devnet/data/sidecar, built by devnet/setup-sidecar.sh)
#   POPCORN_KEYS_DIR       extra keys dir whose *.json addresses get premined (default <repo>/keys if present)
#   LOCAL_LIBRARY=0        skip replaying the organisers' mainnet contract library (LINK, USDT, ..., Railgun)
#   LOCAL_LIBRARY=bg       replay it in the background (log: data/predeploy.log) instead of waiting
#   LOCAL_GENESIS_DELAY    seconds between genesis and slot 0 (default 30)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
# shellcheck source=devnet/env.sh
source "$here/env.sh"

log() { printf '\033[1m[local]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[local] %s\033[0m\n' "$*" >&2; exit 1; }

for bin in docker cast bun python3 curl; do command -v "$bin" >/dev/null || die "$bin not found"; done
"$here/setup-sidecar.sh" || die "could not build the patched sidecar (devnet/setup-sidecar.sh)"
[[ -x "$SIDECAR_DIR/skandha" && -f "$SIDECAR_DIR/packages/cli/lib/cli.js" ]] || die "sidecar not built at $SIDECAR_DIR"

mkdir -p "$DATA" "$KEYS"
dc() { docker compose -f "$here/docker-compose.yml" --project-directory "$here" "$@"; }

# ------------------------------------------------------------------ keys
MNEMONIC="test test test test test test test test test test test junk"   # anvil/hardhat public test mnemonic
for i in $(seq 0 9); do
  f="$KEYS/dev-$i.json"
  [[ -f "$f" ]] && continue
  pk="$(cast wallet private-key "$MNEMONIC" "$i")"
  addr="$(cast wallet address "$pk")"
  (umask 077; printf '[{"address":"%s","private_key":"%s"}]\n' "$addr" "$pk" > "$f")
done

# ------------------------------------------------------------------ genesis
if [[ ! -f "$DATA/genesis/metadata/genesis.json" ]]; then
  log "rendering genesis config"
  extra="${POPCORN_KEYS_DIR:-$root/keys}"
  python3 - "$here/genesis.values.env" "$DATA/genesis.values.env" "$KEYS" "$extra" \
      "$here/predeploys/NaiveStakingRegistry.runtime.hex" "${LOCAL_GENESIS_DELAY:-30}" <<'PY'
import glob, json, os, sys
tpl, out, keys, extra, registry, delay = sys.argv[1:7]
premine = {
    "0x5544596212F91984C986A919C8026DF0576816f9": {"balance": "1000000ETH"},   # organisers' genesis key
    "0xa071C572d39ef9C2f6e09450570bC36A85a5CDc0": {"balance": "1000ETH"},      # predeploy deployer
}
for f in sorted(glob.glob(os.path.join(keys, "dev-*.json"))):
    premine[json.load(open(f))[0]["address"]] = {"balance": "1000000ETH"}
if os.path.isdir(extra):
    for f in sorted(glob.glob(os.path.join(extra, "*.json"))):
        try:
            a = json.load(open(f))[0]["address"]   # addresses only; keys are never read into genesis
        except Exception:
            continue
        premine.setdefault(a, {"balance": "1000ETH"})
code = open(registry).read().strip()
preloaded = {
    # organisers' EIP-8282 deposit-predeploy inhibitor workaround, verbatim
    "0x0000BFF46984E3725691FA540A8C7589300D8282": {"balance": "0", "nonce": "1", "code": "0x3373fffffffffffffffffffffffffffffffffffffffe1461011c575f54807fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff146102705760015460088111605257506058565b60089003015b601190600182026001905f5b5f821115607f57810190830284830290049160010191906064565b90939004925050503660b814609f57366102705734610270575f5260205ff35b8034106102705760383567ffffffffffffffff1680633b9aca001161027057633b9aca00029034031061027057600154600101600155600354806006026004015f358155600101602035815560010160403581556001016060358155600101608035815560010160a035905560b85f5f3760b85fa0600101600355005b60035460025480820380604011610131575060405b5f5b8181146101d7578281016006026004018160b8028154815260200181600101548152602001816002015480825260401c67ffffffffffffffff16816010018160381c81600701538160301c81600601538160281c81600501538160201c81600401538160181c81600301538160101c81600201538160081c816001015353602001816003015481526020018160040154815260200190600501549052600101610133565b91018092146101e957906002556101f4565b90505f6002555f6003555b36610242575f54600154817fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1461023057600882820111610238575b50505f610264565b0160089003610264565b7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff5b5f555f60015560b8025ff35b5f5ffd", "storage": {"0x0000000000000000000000000000000000000000000000000000000000000000": "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}},
    "0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f": {"balance": "0", "nonce": "1", "code": code},
}
s = open(tpl).read()
s = s.replace("__GENESIS_DELAY__", delay).replace("__EL_PREMINE_ADDRS__", json.dumps(premine)).replace("__PRELOADED__", json.dumps(preloaded))
open(out, "w").write(s)
print(f"  premine: {len(premine)} accounts")
PY
  log "generating genesis (chain id 1338)"
  # stale chain data from an earlier genesis would not match the new one
  [[ -d "$DATA/ethrex" ]] && die "data/ethrex exists without a genesis; run devnet/reset.sh first"
  GENESIS_TIMESTAMP="$(date +%s)" dc run --rm --no-deps genesis >"$DATA/genesis.log" 2>&1 \
    || { tail -30 "$DATA/genesis.log"; die "genesis generator failed (log: $DATA/genesis.log)"; }
fi
if [[ ! -d "$DATA/validator-keys/keystores/keys" ]]; then
  log "deriving validator keystores"
  dc run --rm --no-deps validator-keys >"$DATA/validator-keys.log" 2>&1 \
    || { tail -30 "$DATA/validator-keys.log"; die "validator-keys failed"; }
fi

# ------------------------------------------------------------------ chain
log "starting ethrex + lighthouse-beacon"
dc up -d --no-deps ethrex lighthouse-beacon >/dev/null 2>&1 || dc up -d --no-deps ethrex lighthouse-beacon
if [[ ! -s "$DATA/beacon1.enr" ]]; then
  for _ in $(seq 1 60); do
    enr="$(curl -s -m 3 "http://127.0.0.1:$BEACON_PORT/eth/v1/node/identity" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["enr"])' 2>/dev/null || true)"
    [[ -n "$enr" ]] && { echo "$enr" > "$DATA/beacon1.enr"; break; }
    sleep 2
  done
  [[ -s "$DATA/beacon1.enr" ]] || die "lighthouse-beacon HTTP API did not come up (docker compose -f devnet/docker-compose.yml logs lighthouse-beacon)"
fi
log "starting lighthouse-beacon-2 + validator"
LIGHTHOUSE_BEACON_1_ENR="$(cat "$DATA/beacon1.enr")" dc up -d --no-deps lighthouse-beacon-2 lighthouse-validator >/dev/null

rpc() { curl -s -m 5 "$RPC_URL" -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-[]}}"; }
result() { python3 -c 'import json,sys; r=json.load(sys.stdin); print(r.get("result") if r.get("result") is not None else "")' 2>/dev/null; }

chain_id="$(rpc eth_chainId | result)"
[[ "$chain_id" == "0x53a" ]] || { sleep 5; chain_id="$(rpc eth_chainId | result)"; }
[[ "$chain_id" == "0x53a" ]] || die "ethrex at $RPC_URL answers chain id '$chain_id', expected 0x53a (1338)"

# Hegota (frame transactions) activates at epoch 2 = genesis time + 2 * 32 slots * 6 s.
genesis_time="$(python3 -c 'import re,sys; print(re.search(r"^MIN_GENESIS_TIME:\s*(\d+)", open(sys.argv[1]).read(), re.M).group(1))' "$DATA/genesis/metadata/config.yaml")"
delay="$(python3 -c 'import re,sys; print(re.search(r"^GENESIS_DELAY:\s*(\d+)", open(sys.argv[1]).read(), re.M).group(1))' "$DATA/genesis/metadata/config.yaml")"
hegota=$((genesis_time + delay + 2 * 32 * 6))
log "waiting for blocks (Hegota at $(date -d "@$hegota" +%T), $(( hegota - $(date +%s) > 0 ? hegota - $(date +%s) : 0 )) s from now)"
last=""
while :; do
  head="$(rpc eth_getBlockByNumber '["latest",false]' | python3 -c 'import json,sys; b=json.load(sys.stdin)["result"]; print(int(b["number"],16), int(b["timestamp"],16))' 2>/dev/null || true)"
  if [[ -n "$head" ]]; then
    read -r num ts <<<"$head"
    if (( num > 0 && ts >= hegota )); then log "block $num at $(date -d "@$ts" +%T): Hegota active"; break; fi
    [[ "$num" != "$last" ]] && { printf '  block %s\n' "$num"; last="$num"; }
  fi
  (( $(date +%s) > hegota + 300 )) && die "no Hegota block 5 minutes after the fork time; check 'docker compose -f devnet/docker-compose.yml logs'"
  sleep 6
done

# ------------------------------------------------------------------ predeploys
code="$(rpc eth_getCode "[\"$STAKING_REGISTRY\",\"latest\"]" | result)"
[[ "${#code}" -gt 4 ]] || die "NaiveStakingRegistry missing at $STAKING_REGISTRY"
log "NaiveStakingRegistry at $STAKING_REGISTRY ($(( (${#code} - 2) / 2 )) bytes, genesis)"
case "${LOCAL_LIBRARY:-1}" in
  0) log "skipping the contract library (LOCAL_LIBRARY=0)" ;;
  bg) log "replaying the contract library in the background (log: $DATA/predeploy.log)"
      nohup "$here/predeploy.sh" >"$DATA/predeploy.log" 2>&1 & ;;
  *) "$here/predeploy.sh" ;;
esac

# ------------------------------------------------------------------ sidecar
sidecar_up() { curl -s -m 3 "$SIDECAR_URL" -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' | grep -q '"0x53a"'; }
if sidecar_up; then
  log "sidecar already up at $SIDECAR_URL"
else
  log "starting the patched sidecar (standalone, auto bundling) on :$SIDECAR_PORT"
  mkdir -p "$DATA/sidecar"
  relayer="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0]["private_key"])' "$KEYS/dev-9.json")"
  (umask 077; sed -e "s/__RELAYER_KEY__/$relayer/" -e "s#__RPC__#http://127.0.0.1:$RPC_PORT#g" \
      "$here/sidecar-config.json" > "$DATA/sidecar/config.json")
  (cd "$SIDECAR_DIR" || exit 1; nohup ./skandha standalone --configFile "$DATA/sidecar/config.json" --dataDir "$DATA/sidecar/db" \
     --api.address 127.0.0.1 --api.port "$SIDECAR_PORT" --api.wsPort "$SIDECAR_PORT" \
     --executor.bundlingMode auto --redirectRpc --explorer.enable >"$DATA/sidecar/sidecar.log" 2>&1 &
   echo $! > "$DATA/sidecar/sidecar.pid")
  for _ in $(seq 1 90); do sidecar_up && break; sleep 1; done
  sidecar_up || die "sidecar did not answer within 90 s (log: $DATA/sidecar/sidecar.log)"
fi

# ------------------------------------------------------------------ explorer (devnet-ui)
if curl -s -m 3 -o /dev/null "http://127.0.0.1:$EXPLORER_PORT/"; then
  log "explorer already up at $EXPLORER_URL"
else
  want="[{\"name\":\"Local devnet (1338)\",\"url\":\"$SIDECAR_URL\"}]"
  if [[ ! -f "$DATA/explorer/index.html" || "$(cat "$DATA/explorer.instances" 2>/dev/null)" != "$want" ]]; then
    log "building devnet-ui for $SIDECAR_URL"
    [[ -d "$SIDECAR_DIR/packages/types/lib" ]] || die "build the sidecar's packages/types first"
    (cd "$SIDECAR_DIR/packages/devnet-ui" && VITE_EXPLORER_INSTANCES="$want" bunx vite build --outDir "$DATA/explorer" --emptyOutDir >"$DATA/explorer-build.log" 2>&1) \
      || die "devnet-ui build failed (log: $DATA/explorer-build.log)"
    echo "$want" > "$DATA/explorer.instances"
  fi
  nohup bun "$here/serve-explorer.ts" "$DATA/explorer" "$EXPLORER_PORT" >"$DATA/explorer.log" 2>&1 &
  echo $! > "$DATA/explorer.pid"
  for _ in $(seq 1 20); do curl -s -m 2 -o /dev/null "http://127.0.0.1:$EXPLORER_PORT/" && break; sleep 0.5; done
fi

# ------------------------------------------------------------------ Popcorn
log "RuleFactory"
(cd "$root" && bun packages/sdk/scripts/deploy-factory.ts --ensure) || die "deploy-factory.ts failed"

cat <<EOF

  Local devnet is up (chain id 1338).
    ethrex RPC       $RPC_URL            (MAX_VERIFY_GAS 250,000)
    sidecar/gateway  $SIDECAR_URL     (ERC-8421, 250k unstaked / 2.5M staked, auto bundling)
    explorer         $EXPLORER_URL
    beacon API       http://127.0.0.1:$BEACON_PORT
    dev keys         $KEYS/dev-{0..9}.json
  SDK: popcorn({ devnet: "local" });  tests: POPCORN_DEVNET=local
  Stop: devnet/down.sh   Wipe: devnet/reset.sh
EOF
