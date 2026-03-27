#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TUNNEL_TOKEN="${1:-}"
TUNNEL_LABEL="${2:-formal-tunnel}"
TUNNEL_PROTOCOL="${3:-http2}"
TUNNEL_TOKEN_FILE="${4:-$ROOT_DIR/data/private/${TUNNEL_LABEL}.token}"
TUNNEL_HEALTH_URL="${5:-}"
CHECK_INTERVAL_SECONDS="${6:-15}"
UNHEALTHY_SECONDS="${7:-120}"
STARTUP_GRACE_SECONDS="${8:-45}"
MAX_UNHEALTHY_STREAK="${9:-6}"
RUNTIME_DIR="$ROOT_DIR/data/runtime"
SUPERVISOR_PID_FILE="$RUNTIME_DIR/${TUNNEL_LABEL}.pid"
CHILD_PID_FILE="$RUNTIME_DIR/${TUNNEL_LABEL}.child.pid"
LOG_FILE="$RUNTIME_DIR/${TUNNEL_LABEL}.log"
BINARY_PATH="$ROOT_DIR/tools/cloudflared/bin/cloudflared-linux-amd64"

mkdir -p "$RUNTIME_DIR"

log_line() {
  echo "[$(date -Is)] [watch:$TUNNEL_LABEL] $*" >>"$LOG_FILE"
}

if [[ -z "$TUNNEL_TOKEN" && -f "$TUNNEL_TOKEN_FILE" ]]; then
  TUNNEL_TOKEN="$(tr -d '\r\n' < "$TUNNEL_TOKEN_FILE")"
fi

if [[ -z "$TUNNEL_TOKEN" ]]; then
  log_line "missing tunnel token"
  exit 1
fi

if [[ ! -x "$BINARY_PATH" ]]; then
  log_line "cloudflared binary missing at $BINARY_PATH"
  exit 1
fi

CURRENT_CHILD_PID=""

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$CURRENT_CHILD_PID" ]] && kill -0 "$CURRENT_CHILD_PID" 2>/dev/null; then
    kill "$CURRENT_CHILD_PID" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$CURRENT_CHILD_PID" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    kill -9 "$CURRENT_CHILD_PID" 2>/dev/null || true
  fi
  rm -f "$CHILD_PID_FILE"
  if [[ -f "$SUPERVISOR_PID_FILE" ]] && [[ "$(cat "$SUPERVISOR_PID_FILE" 2>/dev/null || true)" == "$$" ]]; then
    rm -f "$SUPERVISOR_PID_FILE"
  fi
}

trap cleanup EXIT INT TERM

echo "$$" >"$SUPERVISOR_PID_FILE"
log_line "supervisor started protocol=$TUNNEL_PROTOCOL healthUrl=${TUNNEL_HEALTH_URL:-none}"

http_code_is_healthy() {
  case "$1" in
    2??|3??|4??)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

fetch_health_code() {
  if [[ -z "$TUNNEL_HEALTH_URL" ]]; then
    echo ""
    return 0
  fi

  curl -k -sS -o /dev/null -w '%{http_code}' --max-time 10 "$TUNNEL_HEALTH_URL" || echo "000"
}

last_registered_epoch() {
  local last_success_line timestamp
  last_success_line="$(tail -n 400 "$LOG_FILE" | grep 'Registered tunnel connection' | tail -n 1 || true)"
  timestamp="$(awk '{print $1}' <<<"$last_success_line")"
  if [[ -z "$timestamp" ]]; then
    echo 0
    return 0
  fi

  date -u -d "$timestamp" +%s 2>/dev/null || echo 0
}

recent_edge_error() {
  tail -n 200 "$LOG_FILE" | grep -q 'TLS handshake with edge error\|there are no free edge addresses left to resolve to'
}

stop_child() {
  local reason="${1:-requested}"
  if [[ -n "$CURRENT_CHILD_PID" ]] && kill -0 "$CURRENT_CHILD_PID" 2>/dev/null; then
    log_line "stopping child pid=$CURRENT_CHILD_PID reason=$reason"
    kill "$CURRENT_CHILD_PID" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$CURRENT_CHILD_PID" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    kill -9 "$CURRENT_CHILD_PID" 2>/dev/null || true
  fi
}

while true; do
  log_line "starting cloudflared child"
  "$BINARY_PATH" tunnel --no-autoupdate --protocol "$TUNNEL_PROTOCOL" run --token "$TUNNEL_TOKEN" </dev/null >>"$LOG_FILE" 2>&1 &
  CURRENT_CHILD_PID=$!
  echo "$CURRENT_CHILD_PID" >"$CHILD_PID_FILE"
  local_started_at="$(date +%s)"
  unhealthy_streak=0

  while kill -0 "$CURRENT_CHILD_PID" 2>/dev/null; do
    sleep "$CHECK_INTERVAL_SECONDS"
    if ! kill -0 "$CURRENT_CHILD_PID" 2>/dev/null; then
      break
    fi

    now_epoch="$(date +%s)"
    if (( now_epoch - local_started_at < STARTUP_GRACE_SECONDS )); then
      continue
    fi

    health_code="$(fetch_health_code)"
    health_ok=0
    if [[ -n "$health_code" ]] && http_code_is_healthy "$health_code"; then
      health_ok=1
    fi

    if (( health_ok == 1 )); then
      unhealthy_streak=0
      continue
    fi

    if [[ -n "$health_code" ]]; then
      unhealthy_streak=$((unhealthy_streak + 1))
      log_line "health check unhealthy httpCode=$health_code streak=$unhealthy_streak"
    else
      last_success_epoch="$(last_registered_epoch)"
      success_recent=0
      if (( last_success_epoch > 0 && now_epoch - last_success_epoch <= UNHEALTHY_SECONDS )); then
        success_recent=1
      fi

      if (( success_recent == 1 )); then
        unhealthy_streak=0
        continue
      fi

      if recent_edge_error; then
        unhealthy_streak=$((unhealthy_streak + 1))
        log_line "edge log unhealthy lastSuccessEpoch=$last_success_epoch streak=$unhealthy_streak"
      else
        unhealthy_streak=0
      fi
    fi

    if (( unhealthy_streak >= MAX_UNHEALTHY_STREAK )); then
      stop_child "edge unhealthy httpCode=${health_code:-none}"
      break
    fi
  done

  set +e
  wait "$CURRENT_CHILD_PID"
  child_exit_code=$?
  set -e
  log_line "child exited code=$child_exit_code; restarting in 5s"
  rm -f "$CHILD_PID_FILE"
  CURRENT_CHILD_PID=""
  sleep 5
done
