#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TUNNEL_TOKEN="${1:-${CLOUDFLARED_TUNNEL_TOKEN:-}}"
TUNNEL_LABEL="${2:-formal-tunnel}"
TUNNEL_PROTOCOL="${3:-${CLOUDFLARED_TUNNEL_PROTOCOL:-http2}}"
DEFAULT_TOKEN_FILE="$ROOT_DIR/data/private/${TUNNEL_LABEL}.token"
TUNNEL_TOKEN_FILE="${4:-${CLOUDFLARED_TUNNEL_TOKEN_FILE:-$DEFAULT_TOKEN_FILE}}"
TUNNEL_HEALTH_URL="${5:-${CLOUDFLARED_TUNNEL_HEALTH_URL:-}}"
CHECK_INTERVAL_SECONDS="${6:-${CLOUDFLARED_TUNNEL_CHECK_INTERVAL_SECONDS:-15}}"
UNHEALTHY_SECONDS="${7:-${CLOUDFLARED_TUNNEL_UNHEALTHY_SECONDS:-120}}"
STARTUP_GRACE_SECONDS="${8:-${CLOUDFLARED_TUNNEL_STARTUP_GRACE_SECONDS:-45}}"
RUNTIME_DIR="$ROOT_DIR/data/runtime"
PID_FILE="$RUNTIME_DIR/${TUNNEL_LABEL}.pid"
LOG_FILE="$RUNTIME_DIR/${TUNNEL_LABEL}.log"
BINARY_DIR="$ROOT_DIR/tools/cloudflared/bin"
BINARY_PATH="$BINARY_DIR/cloudflared-linux-amd64"
WATCH_SCRIPT="$ROOT_DIR/scripts/wsl/watch-named-tunnel.sh"

mkdir -p "$RUNTIME_DIR" "$BINARY_DIR"

if [[ -z "$TUNNEL_TOKEN" && -f "$TUNNEL_TOKEN_FILE" ]]; then
  TUNNEL_TOKEN="$(tr -d '\r\n' < "$TUNNEL_TOKEN_FILE")"
fi

if [[ -z "$TUNNEL_TOKEN" ]]; then
  echo "usage: $0 <cloudflared-token> [label]" >&2
  echo "or set CLOUDFLARED_TUNNEL_TOKEN or place the token in $TUNNEL_TOKEN_FILE." >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "$TUNNEL_LABEL already running with pid $PID"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [[ ! -x "$BINARY_PATH" ]]; then
  RELEASE_URL="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/cloudflare/cloudflared/releases/latest)"
  TAG="${RELEASE_URL##*/}"
  DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/download/${TAG}/cloudflared-linux-amd64"
  curl -L --fail -o "$BINARY_PATH" "$DOWNLOAD_URL"
  chmod +x "$BINARY_PATH"
fi

touch "$LOG_FILE"
echo "[$(date -Is)] launching named tunnel $TUNNEL_LABEL with protocol $TUNNEL_PROTOCOL" >>"$LOG_FILE"

cd "$ROOT_DIR"
setsid "$WATCH_SCRIPT" "$TUNNEL_TOKEN" "$TUNNEL_LABEL" "$TUNNEL_PROTOCOL" "$TUNNEL_TOKEN_FILE" "$TUNNEL_HEALTH_URL" "$CHECK_INTERVAL_SECONDS" "$UNHEALTHY_SECONDS" "$STARTUP_GRACE_SECONDS" </dev/null >>"$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" >"$PID_FILE"
sleep 0.5

if ! kill -0 "$PID" 2>/dev/null; then
  echo "$TUNNEL_LABEL failed to start" >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  rm -f "$PID_FILE"
  exit 1
fi

echo "$TUNNEL_LABEL started with pid $PID"
