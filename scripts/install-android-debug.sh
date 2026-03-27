#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ADB_BIN="$ROOT_DIR/.tools/android-sdk/platform-tools/adb"
ADB_BIN=""
APK_PATH="$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
WINDOWS_BUILD_APK_PATH="/mnt/d/software/Android/remocli_build/project/android/app/build/outputs/apk/debug/app-debug.apk"
DEFAULT_TARGET_MODEL=""
TARGET_MODEL="${REMOTE_CONNECT_USB_MODEL:-$DEFAULT_TARGET_MODEL}"
TARGET_SERIAL="${REMOTE_CONNECT_USB_SERIAL:-}"

if [[ ! -f "$APK_PATH" && -f "$WINDOWS_BUILD_APK_PATH" ]]; then
  APK_PATH="$WINDOWS_BUILD_APK_PATH"
fi

if [[ ! -f "$APK_PATH" ]]; then
  echo "APK not found at $APK_PATH or $WINDOWS_BUILD_APK_PATH" >&2
  exit 1
fi

if [[ -x "$LOCAL_ADB_BIN" ]]; then
  if "$LOCAL_ADB_BIN" devices | awk 'NR>1 && $2=="device" { found=1 } END { exit found ? 0 : 1 }'; then
    ADB_BIN="$LOCAL_ADB_BIN"
  fi
fi

if [[ -z "$ADB_BIN" ]]; then
  WINDOWS_ADB="$(cmd.exe /c where adb 2>/dev/null | tr -d '\r' | head -n 1 || true)"
  if [[ -n "$WINDOWS_ADB" ]]; then
    ADB_BIN="$(wslpath -u "$WINDOWS_ADB")"
  fi
fi

if [[ ! -x "$ADB_BIN" ]]; then
  echo "adb not found in local tools or Windows PATH" >&2
  exit 1
fi

list_device_lines() {
  "$ADB_BIN" devices -l | awk 'NR > 1 && $2 == "device" { print }'
}

resolve_target_serial() {
  local devices serial

  devices="$(list_device_lines)"
  if [[ -z "$devices" ]]; then
    echo "No adb devices in device state" >&2
    return 1
  fi

  if [[ -n "$TARGET_SERIAL" ]]; then
    serial="$(awk -v preferred="$TARGET_SERIAL" '$1 == preferred { print $1; exit }' <<<"$devices")"
    if [[ -n "$serial" ]]; then
      echo "$serial"
      return 0
    fi

    echo "Preferred adb serial is not connected: $TARGET_SERIAL" >&2
    printf '%s\n' "$devices" >&2
    return 1
  fi

  if [[ -n "$TARGET_MODEL" ]]; then
    serial="$(awk -v preferred_model="model:$TARGET_MODEL" '$0 ~ preferred_model { print $1; exit }' <<<"$devices")"
    if [[ -n "$serial" ]]; then
      echo "$serial"
      return 0
    fi

    echo "Preferred adb model is not connected: $TARGET_MODEL" >&2
    printf '%s\n' "$devices" >&2
    return 1
  fi

  awk 'NR == 1 { print $1 }' <<<"$devices"
}

install_apk() {
  local output status remote_tmp_apk

  if output="$("$ADB_BIN" -s "$TARGET_SERIAL" install -r "$APK_PATH" 2>&1)"; then
    printf '%s\n' "$output"
    return 0
  fi

  status=$?
  printf '%s\n' "$output" >&2

  if [[ "$output" == *"INSTALL_FAILED_UPDATE_INCOMPATIBLE"* ]]; then
    echo "Installed package signature does not match. Uninstall com.remoteconnect.mobile first." >&2
    return "$status"
  fi

  if [[ "$output" != *"INSTALL_FAILED_USER_RESTRICTED"* ]]; then
    return "$status"
  fi

  remote_tmp_apk="/data/local/tmp/remocli-debug.apk"
  echo "adb install was blocked by the device; falling back to shell pm install." >&2
  "$ADB_BIN" -s "$TARGET_SERIAL" push "$APK_PATH" "$remote_tmp_apk" >&2
  "$ADB_BIN" -s "$TARGET_SERIAL" shell pm install -t -r "$remote_tmp_apk"
}

if [[ "$ADB_BIN" == *.exe ]]; then
  APK_PATH="$(wslpath -w "$APK_PATH")"
fi

"$ADB_BIN" start-server
"$ADB_BIN" devices -l
TARGET_SERIAL="$(resolve_target_serial)"
if [[ -n "$TARGET_MODEL" ]]; then
  echo "Using adb target: $TARGET_SERIAL (model:$TARGET_MODEL)"
else
  echo "Using adb target: $TARGET_SERIAL"
fi

if [[ "${REMOTE_CONNECT_ANDROID_DEBUG_DRY_RUN:-0}" == "1" ]]; then
  exit 0
fi

"$ADB_BIN" -s "$TARGET_SERIAL" reverse tcp:8080 tcp:8080
install_apk
