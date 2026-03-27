#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOYMENT_CONFIG_PATH="${1:-config/deployment.local.json}"
RUNTIME_DIR="$ROOT_DIR/data/runtime"
PID_FILE="$RUNTIME_DIR/gotify.pid"
LOG_FILE="$RUNTIME_DIR/gotify.log"

mkdir -p "$RUNTIME_DIR"

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

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "gotify already running with pid $PID"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

mapfile -t GOTIFY_VALUES < <(
  node - "$ABS_DEPLOYMENT_CONFIG_PATH" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const deploymentPath = path.resolve(process.argv[2]);
const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
const service = deployment.gotify?.service;

if (!service) {
  throw new Error('deployment.gotify.service is required');
}

if (!service.adminPass) {
  throw new Error('deployment.gotify.service.adminPass is required');
}

const values = [
  service.binaryPath || 'tools/gotify/bin/gotify-linux-amd64',
  service.listenHost || '127.0.0.1',
  String(service.listenPort || 18080),
  service.dataDir || 'tools/gotify/data',
  service.adminUser || 'admin',
  service.adminPass,
];

for (const value of values) {
  console.log(value);
}
NODE
)

BINARY_PATH="${GOTIFY_VALUES[0]}"
LISTEN_HOST="${GOTIFY_VALUES[1]}"
LISTEN_PORT="${GOTIFY_VALUES[2]}"
DATA_DIR="${GOTIFY_VALUES[3]}"
ADMIN_USER="${GOTIFY_VALUES[4]}"
ADMIN_PASS="${GOTIFY_VALUES[5]}"

if [[ "$BINARY_PATH" = /* ]]; then
  ABS_BINARY_PATH="$BINARY_PATH"
else
  ABS_BINARY_PATH="$ROOT_DIR/$BINARY_PATH"
fi

if [[ "$DATA_DIR" = /* ]]; then
  ABS_DATA_DIR="$DATA_DIR"
else
  ABS_DATA_DIR="$ROOT_DIR/$DATA_DIR"
fi

ABS_BINARY_PATH="$(realpath "$ABS_BINARY_PATH")"
mkdir -p "$ABS_DATA_DIR/images" "$ABS_DATA_DIR/plugins"

if [[ ! -x "$ABS_BINARY_PATH" ]]; then
  echo "gotify binary not executable: $ABS_BINARY_PATH" >&2
  exit 1
fi

touch "$LOG_FILE"
echo "[$(date -Is)] launching gotify via $ABS_BINARY_PATH on $LISTEN_HOST:$LISTEN_PORT" >>"$LOG_FILE"

cd "$ROOT_DIR"
setsid env \
  GOTIFY_SERVER_LISTENADDR="$LISTEN_HOST" \
  GOTIFY_SERVER_PORT="$LISTEN_PORT" \
  GOTIFY_DATABASE_CONNECTION="$ABS_DATA_DIR/gotify.db" \
  GOTIFY_UPLOADEDIMAGESDIR="$ABS_DATA_DIR/images" \
  GOTIFY_PLUGINSDIR="$ABS_DATA_DIR/plugins" \
  GOTIFY_DEFAULTUSER_NAME="$ADMIN_USER" \
  GOTIFY_DEFAULTUSER_PASS="$ADMIN_PASS" \
  GOTIFY_REGISTRATION="false" \
  "$ABS_BINARY_PATH" </dev/null >>"$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" >"$PID_FILE"

sleep 1
if ! kill -0 "$PID" 2>/dev/null; then
  echo "gotify failed to start" >&2
  tail -n 60 "$LOG_FILE" >&2 || true
  rm -f "$PID_FILE"
  exit 1
fi

echo "gotify started with pid $PID"
