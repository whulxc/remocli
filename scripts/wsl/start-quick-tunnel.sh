#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOYMENT_CONFIG_PATH="${1:-config/deployment.quick-tunnel.local.json}"
RUNTIME_DIR="$ROOT_DIR/data/runtime"
PID_FILE="$RUNTIME_DIR/quick-tunnel.pid"
LOG_FILE="$RUNTIME_DIR/quick-tunnel.log"
URL_FILE="$RUNTIME_DIR/quick-tunnel.url"
BINARY_DIR="$ROOT_DIR/tools/cloudflared/bin"
BINARY_PATH="$BINARY_DIR/cloudflared-linux-amd64"

mkdir -p "$RUNTIME_DIR" "$BINARY_DIR"

if [[ "$DEPLOYMENT_CONFIG_PATH" = /* ]]; then
  ABS_DEPLOYMENT_CONFIG_PATH="$DEPLOYMENT_CONFIG_PATH"
else
  ABS_DEPLOYMENT_CONFIG_PATH="$ROOT_DIR/$DEPLOYMENT_CONFIG_PATH"
fi
ABS_DEPLOYMENT_CONFIG_PATH="$(realpath "$ABS_DEPLOYMENT_CONFIG_PATH")"

if [[ ! -f "$ABS_DEPLOYMENT_CONFIG_PATH" ]]; then
  echo "deployment config not found: $ABS_DEPLOYMENT_CONFIG_PATH" >&2
  exit 1
fi

GATEWAY_PORT="$(
  node - "$ABS_DEPLOYMENT_CONFIG_PATH" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const deploymentPath = path.resolve(process.argv[2]);
const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
process.stdout.write(String(deployment.gateway?.listenPort || 8080));
NODE
)"

TUNNEL_PROTOCOL="$(
  node - "$ABS_DEPLOYMENT_CONFIG_PATH" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const deploymentPath = path.resolve(process.argv[2]);
const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
process.stdout.write(String(deployment.gateway?.quickTunnelProtocol || 'http2'));
NODE
)"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    if [[ -f "$URL_FILE" ]]; then
      cat "$URL_FILE"
      exit 0
    fi
    echo "quick tunnel already running with pid $PID" >&2
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

: >"$LOG_FILE"
rm -f "$URL_FILE"
echo "[$(date -Is)] launching quick tunnel for http://127.0.0.1:$GATEWAY_PORT" >>"$LOG_FILE"
echo "[$(date -Is)] quick tunnel protocol $TUNNEL_PROTOCOL" >>"$LOG_FILE"

cd "$ROOT_DIR"
setsid "$BINARY_PATH" tunnel --no-autoupdate --protocol "$TUNNEL_PROTOCOL" --url "http://127.0.0.1:$GATEWAY_PORT" </dev/null >>"$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" >"$PID_FILE"

for _ in {1..120}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "quick tunnel exited unexpectedly" >&2
    tail -n 80 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi

  URL="$(grep -aEo 'https://[-a-z0-9]+\.trycloudflare\.com' "$LOG_FILE" | tail -n 1 || true)"
  if [[ -n "$URL" ]]; then
    printf '%s\n' "$URL" >"$URL_FILE"
    printf '%s\n' "$URL"
    exit 0
  fi

  sleep 0.5
done

echo "quick tunnel did not report a URL in time" >&2
tail -n 80 "$LOG_FILE" >&2 || true
exit 1
