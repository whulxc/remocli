#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android"
LOCAL_JAVA_HOME="$ROOT_DIR/.tools/jdk"
LOCAL_ANDROID_SDK_ROOT="$ROOT_DIR/.tools/android-sdk"
LOCAL_GRADLE_BIN="$ROOT_DIR/.tools/gradle/gradle-8.10.2/bin/gradle"
BUILD_MODE="${REMOTE_CONNECT_ANDROID_BUILD_MODE:-auto}"
WINDOWS_BUILD_DIR="${REMOTE_CONNECT_WINDOWS_BUILD_DIR:-/mnt/d/software/Android/remocli_build}"
WINDOWS_PROJECT_DIR="$WINDOWS_BUILD_DIR/project/android"
WINDOWS_GRADLE_DIR="$WINDOWS_BUILD_DIR/gradle-8.10.2"
WINDOWS_RUN_BUILD_SCRIPT="$WINDOWS_BUILD_DIR/run-build.ps1"
WINDOWS_JAVA_HOME_WIN="${REMOTE_CONNECT_WINDOWS_JAVA_HOME:-D:\software\Android\android-studio-2025.2.2.7-windows\android-studio\jbr}"
WINDOWS_ANDROID_SDK_ROOT_WIN="${REMOTE_CONNECT_WINDOWS_ANDROID_SDK_ROOT:-D:\software\Android\SDK}"
WINDOWS_GRADLE_USER_HOME_WIN="${REMOTE_CONNECT_WINDOWS_GRADLE_USER_HOME:-D:\software\Android\GradleHomeRemoCLI}"
WINDOWS_APK_PATH="$WINDOWS_PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
LOCAL_APK_PATH="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
DOWNLOAD_APK_PATH="$ROOT_DIR/downloads/remocli-debug.apk"

has_local_sdk() {
  [[ -x "$LOCAL_JAVA_HOME/bin/java" ]] &&
    [[ -x "$LOCAL_GRADLE_BIN" ]] &&
    [[ -d "$LOCAL_ANDROID_SDK_ROOT/platforms" ]] &&
    [[ -d "$LOCAL_ANDROID_SDK_ROOT/build-tools" ]]
}

write_local_properties() {
  local destination="$1"
  local sdk_dir="$2"
  cat > "$destination" <<EOF
sdk.dir=$sdk_dir
EOF
}

publish_apk() {
  local source_apk="$1"

  mkdir -p "$(dirname "$LOCAL_APK_PATH")" "$(dirname "$DOWNLOAD_APK_PATH")"
  if [[ "$source_apk" != "$LOCAL_APK_PATH" ]]; then
    cp "$source_apk" "$LOCAL_APK_PATH"
  fi
  cp "$source_apk" "$DOWNLOAD_APK_PATH"
  printf 'Project APK path: %s\n' "$LOCAL_APK_PATH"
  printf 'Download APK path: %s\n' "$DOWNLOAD_APK_PATH"
}

build_with_local_sdk() {
  local local_properties_path="$ANDROID_DIR/local.properties"
  local local_properties_backup=""

  if [[ -f "$local_properties_path" ]]; then
    local_properties_backup="$(mktemp)"
    cp "$local_properties_path" "$local_properties_backup"
  fi

  restore_local_properties() {
    trap - RETURN
    if [[ -n "$local_properties_backup" ]]; then
      cp "$local_properties_backup" "$local_properties_path"
      rm -f "$local_properties_backup"
    else
      rm -f "$local_properties_path"
    fi
  }

  trap restore_local_properties RETURN
  write_local_properties "$local_properties_path" "$LOCAL_ANDROID_SDK_ROOT"

  PATH="$LOCAL_JAVA_HOME/bin:$LOCAL_ANDROID_SDK_ROOT/platform-tools:$PATH" \
  JAVA_HOME="$LOCAL_JAVA_HOME" \
  ANDROID_HOME="$LOCAL_ANDROID_SDK_ROOT" \
  ANDROID_SDK_ROOT="$LOCAL_ANDROID_SDK_ROOT" \
  "$LOCAL_GRADLE_BIN" -p "$ANDROID_DIR" assembleDebug

  publish_apk "$LOCAL_APK_PATH"
}

build_with_windows_sdk() {
  local windows_build_dir_win
  local windows_project_dir_win
  local windows_gradle_bin_win
  local windows_run_build_script_win
  local windows_apk_path_win

  mkdir -p "$WINDOWS_BUILD_DIR" "$WINDOWS_PROJECT_DIR"

  if [[ ! -f "$WINDOWS_GRADLE_DIR/bin/gradle.bat" ]]; then
    cp -a "$ROOT_DIR/.tools/gradle/gradle-8.10.2" "$WINDOWS_BUILD_DIR/"
  fi

  rsync -a --delete --exclude 'app/build/' "$ANDROID_DIR/" "$WINDOWS_PROJECT_DIR/"
  write_local_properties "$WINDOWS_PROJECT_DIR/local.properties" "${WINDOWS_ANDROID_SDK_ROOT_WIN//\\//}"

  windows_build_dir_win="$(wslpath -w "$WINDOWS_BUILD_DIR")"
  windows_project_dir_win="$(wslpath -w "$WINDOWS_PROJECT_DIR")"
  windows_gradle_bin_win="$(wslpath -w "$WINDOWS_GRADLE_DIR/bin/gradle.bat")"
  windows_run_build_script_win="$(wslpath -w "$WINDOWS_RUN_BUILD_SCRIPT")"

  cat > "$WINDOWS_RUN_BUILD_SCRIPT" <<EOF
\$ErrorActionPreference = 'Stop'
\$env:JAVA_HOME = '$WINDOWS_JAVA_HOME_WIN'
\$env:ANDROID_HOME = '$WINDOWS_ANDROID_SDK_ROOT_WIN'
\$env:ANDROID_SDK_ROOT = '$WINDOWS_ANDROID_SDK_ROOT_WIN'
\$env:GRADLE_USER_HOME = '$WINDOWS_GRADLE_USER_HOME_WIN'
Set-Location '$windows_project_dir_win'
& '$windows_gradle_bin_win' --no-daemon --console=plain -p . assembleDebug
if (\$LASTEXITCODE -ne 0) {
  exit \$LASTEXITCODE
}
EOF
  windows_apk_path_win="$(wslpath -w "$WINDOWS_APK_PATH")"

  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Set-Location '$windows_build_dir_win'; & '$windows_run_build_script_win'"

  publish_apk "$WINDOWS_APK_PATH"
  printf 'Windows APK path: %s\n' "$windows_apk_path_win"
}

case "$BUILD_MODE" in
  auto)
    if has_local_sdk; then
      build_with_local_sdk
    else
      build_with_windows_sdk
    fi
    ;;
  local)
    if ! has_local_sdk; then
      echo "Local Android toolchain is incomplete under $ROOT_DIR/.tools" >&2
      exit 1
    fi
    build_with_local_sdk
    ;;
  windows)
    build_with_windows_sdk
    ;;
  *)
    echo "Unsupported REMOTE_CONNECT_ANDROID_BUILD_MODE: $BUILD_MODE" >&2
    exit 1
    ;;
esac
