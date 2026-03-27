#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TUNNEL_LABEL="${1:-formal-tunnel}"
TUNNEL_HEALTH_URL="${2:-}"
PID_FILE="$ROOT_DIR/data/runtime/${TUNNEL_LABEL}.pid"
CHILD_PID_FILE="$ROOT_DIR/data/runtime/${TUNNEL_LABEL}.child.pid"
LOG_FILE="$ROOT_DIR/data/runtime/${TUNNEL_LABEL}.log"

last_matching_line() {
  local pattern="$1"
  tail -n 400 "$LOG_FILE" 2>/dev/null | grep "$pattern" | tail -n 1 || true
}

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    STATUS_LINE="$TUNNEL_LABEL running supervisorPid=$PID"
    if [[ -f "$CHILD_PID_FILE" ]]; then
      CHILD_PID="$(cat "$CHILD_PID_FILE")"
      if kill -0 "$CHILD_PID" 2>/dev/null; then
        STATUS_LINE="$STATUS_LINE childPid=$CHILD_PID"
      else
        STATUS_LINE="$STATUS_LINE childPid=stopped"
      fi
    fi
    if [[ -n "$TUNNEL_HEALTH_URL" ]]; then
      HEALTH_CODE="$(curl -k -sS -o /dev/null -w '%{http_code}' --max-time 10 "$TUNNEL_HEALTH_URL" || echo '000')"
      STATUS_LINE="$STATUS_LINE healthCode=$HEALTH_CODE"
    fi
    echo "$STATUS_LINE log=$LOG_FILE"
    LAST_SUCCESS="$(last_matching_line 'Registered tunnel connection')"
    LAST_ERROR="$(last_matching_line ' ERR ')"
    if [[ -n "$LAST_SUCCESS" ]]; then
      echo "lastSuccess: $LAST_SUCCESS"
    fi
    if [[ -n "$LAST_ERROR" ]]; then
      echo "lastError: $LAST_ERROR"
    fi
    exit 0
  fi
fi

echo "$TUNNEL_LABEL stopped"
