#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BINARY_PATH="${1:-tools/gotify/bin/gotify-linux-amd64}"

if [[ "$BINARY_PATH" = /* ]]; then
  ABS_BINARY_PATH="$BINARY_PATH"
else
  ABS_BINARY_PATH="$ROOT_DIR/$BINARY_PATH"
fi

BINARY_DIR="$(dirname "$ABS_BINARY_PATH")"
ZIP_PATH="$BINARY_DIR/gotify-linux-amd64.zip"
DOWNLOAD_URL="$(curl -fsSLI -o /dev/null -w '%{url_effective}' https://github.com/gotify/server/releases/latest/download/gotify-linux-amd64.zip)"

mkdir -p "$BINARY_DIR"

if [[ -x "$ABS_BINARY_PATH" ]]; then
  printf '%s\n' "$ABS_BINARY_PATH"
  exit 0
fi

curl -L --fail -o "$ZIP_PATH" "$DOWNLOAD_URL"

python3 - "$ZIP_PATH" "$BINARY_DIR" <<'PY'
import sys
import zipfile
from pathlib import Path

zip_path = Path(sys.argv[1])
output_dir = Path(sys.argv[2])

with zipfile.ZipFile(zip_path) as archive:
    members = archive.namelist()
    target_name = next((name for name in members if name.endswith("gotify-linux-amd64")), None)
    if not target_name:
        raise SystemExit("gotify release archive did not contain gotify-linux-amd64")
    archive.extract(target_name, output_dir)
    extracted_path = output_dir / target_name
    final_path = output_dir / "gotify-linux-amd64"
    if extracted_path != final_path:
        extracted_path.replace(final_path)
PY

chmod +x "$ABS_BINARY_PATH"
rm -f "$ZIP_PATH"
printf '%s\n' "$ABS_BINARY_PATH"
