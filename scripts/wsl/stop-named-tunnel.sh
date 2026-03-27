#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TUNNEL_LABEL="${1:-formal-tunnel}"
PID_FILE="$ROOT_DIR/data/runtime/${TUNNEL_LABEL}.pid"
CHILD_PID_FILE="$ROOT_DIR/data/runtime/${TUNNEL_LABEL}.child.pid"

terminate_pid() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return 0
  fi

  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    kill -9 "$pid" 2>/dev/null || true
  fi
}

if [[ ! -f "$PID_FILE" ]]; then
  echo "$TUNNEL_LABEL not running"
  exit 0
fi

PID="$(cat "$PID_FILE")"
terminate_pid "$PID"

if [[ -f "$CHILD_PID_FILE" ]]; then
  CHILD_PID="$(cat "$CHILD_PID_FILE")"
  terminate_pid "$CHILD_PID"
fi

rm -f "$PID_FILE"
rm -f "$CHILD_PID_FILE"
echo "$TUNNEL_LABEL stopped"
