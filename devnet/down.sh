#!/usr/bin/env bash
# Stops the local devnet (containers, sidecar, explorer). Chain data is kept; devnet/up.sh resumes it.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/env.sh"
for p in "$DATA/sidecar/sidecar.pid" "$DATA/explorer.pid" "$DATA/predeploy.pid"; do
  [[ -f "$p" ]] || continue
  pid="$(cat "$p")"
  # the process and its children (./skandha is a bash wrapper around bun)
  kids="$(pgrep -P "$pid" 2>/dev/null || true)"
  kill "$pid" $kids 2>/dev/null && echo "stopped pid $pid ($(basename "$p" .pid))"
  rm -f "$p"
done
docker compose -f "$here/docker-compose.yml" --project-directory "$here" down
