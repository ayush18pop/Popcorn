# Shared settings for devnet/*.sh (sourced). Ports are bound to 127.0.0.1 only and avoid the public-devnet
# tooling (4367/14367).
here="${here:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
DATA="${LOCAL_DATA_DIR:-$here/data}"        # git-ignored; containers write it as root (reset.sh cleans it)
KEYS="$here/keys"                           # git-ignored dev keys
SIDECAR_DIR="${SIDECAR_DIR:-$DATA/sidecar}"   # built by setup-sidecar.sh
RPC_PORT="${LOCAL_RPC_PORT:-18545}"
BEACON_PORT="${LOCAL_BEACON_PORT:-15052}"
SIDECAR_PORT="${LOCAL_SIDECAR_PORT:-14338}"
EXPLORER_PORT="${LOCAL_EXPLORER_PORT:-14339}"
RPC_URL="http://127.0.0.1:$RPC_PORT"
SIDECAR_URL="http://127.0.0.1:$SIDECAR_PORT/rpc"
EXPLORER_URL="http://127.0.0.1:$EXPLORER_PORT"
STAKING_REGISTRY="0xd51c04d7a0b01124e84de152f4e56d9eecb22d2f"
export LOCAL_RPC_PORT="$RPC_PORT" LOCAL_BEACON_PORT="$BEACON_PORT"
