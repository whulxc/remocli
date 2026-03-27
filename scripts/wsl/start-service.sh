#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:?mode is required}"
NAME="${2:?name is required}"
CONFIG_PATH="${3:?config path is required}"
RUNTIME_DIR="$ROOT_DIR/data/runtime"
PID_FILE="$RUNTIME_DIR/$NAME.pid"
LOG_FILE="$RUNTIME_DIR/$NAME.log"

mkdir -p "$RUNTIME_DIR"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "$NAME already running with pid $PID"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

case "$MODE" in
  gateway)
    ENV_KEY="REMOTE_CONNECT_GATEWAY_CONFIG"
    ENTRYPOINT="src/gateway/server.js"
    ;;
  agent)
    ENV_KEY="REMOTE_CONNECT_AGENT_CONFIG"
    ENTRYPOINT="src/agent/server.js"
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    exit 1
    ;;
esac

if [[ "$CONFIG_PATH" = /* ]]; then
  ABS_CONFIG_PATH="$CONFIG_PATH"
else
  ABS_CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
fi

ABS_CONFIG_PATH="$(realpath "$ABS_CONFIG_PATH")"
ENTRYPOINT_PATH="$ROOT_DIR/$ENTRYPOINT"
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "node not found in PATH" >&2
  exit 1
fi

if [[ ! -f "$ABS_CONFIG_PATH" ]]; then
  echo "config not found: $ABS_CONFIG_PATH" >&2
  exit 1
fi

if [[ ! -f "$ENTRYPOINT_PATH" ]]; then
  echo "entrypoint not found: $ENTRYPOINT_PATH" >&2
  exit 1
fi

cd "$ROOT_DIR"
touch "$LOG_FILE"
echo "[$(date -Is)] launching $NAME via $NODE_BIN with $ABS_CONFIG_PATH" >>"$LOG_FILE"
setsid env "$ENV_KEY=$ABS_CONFIG_PATH" "$NODE_BIN" "$ENTRYPOINT_PATH" </dev/null >>"$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"
sleep 0.5
if ! kill -0 "$PID" 2>/dev/null; then
  echo "$NAME failed to start" >&2
  tail -n 40 "$LOG_FILE" >&2 || true
  rm -f "$PID_FILE"
  exit 1
fi
echo "$NAME started with pid $PID"
