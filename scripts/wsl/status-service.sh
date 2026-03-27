#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="${1:?name is required}"
PID_FILE="$ROOT_DIR/data/runtime/$NAME.pid"
LOG_FILE="$ROOT_DIR/data/runtime/$NAME.log"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "$NAME running pid=$PID log=$LOG_FILE"
    exit 0
  fi
fi

echo "$NAME stopped"
