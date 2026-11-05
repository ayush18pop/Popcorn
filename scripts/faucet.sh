#!/usr/bin/env bash
# Funds a key file's address from the public devnet's gateway faucet.
#   scripts/faucet.sh keys/deployer.json
set -euo pipefail
f="${1:?usage: scripts/faucet.sh <key file>}"
addr="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[0]["address"])' "$f")"
curl -s https://altmempoolgateway.forshtat.com/rpc -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"skandha_explorer_faucet\",\"params\":[\"$addr\"]}"
echo
