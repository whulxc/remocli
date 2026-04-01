#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/check-open-source-safety.sh [--base <ref>] [--no-fetch]

Default base ref: origin/main

The script checks:
  1. changed files vs the selected GitHub base
  2. staged and unstaged local changes
  3. blocked private/runtime paths that should never be published
  4. common privacy/secret patterns in the combined diff
EOF
}

BASE_REF="origin/main"
NO_FETCH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --base" >&2
        exit 2
      fi
      BASE_REF="$2"
      shift 2
      ;;
    --no-fetch)
      NO_FETCH=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "Not inside a git repository." >&2
  exit 2
fi

cd "$REPO_ROOT"

if [[ $NO_FETCH -eq 0 && "$BASE_REF" == origin/* ]]; then
  git fetch origin --quiet || {
    echo "Warning: git fetch origin failed; continuing with local refs." >&2
  }
fi

if ! git rev-parse --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "Base ref not found: $BASE_REF" >&2
  exit 2
fi

TMP_DIFF="$(mktemp)"
trap 'rm -f "$TMP_DIFF"' EXIT

{
  git diff --no-ext-diff "$BASE_REF...HEAD" || true
  git diff --no-ext-diff --cached || true
  git diff --no-ext-diff || true
} >"$TMP_DIFF"

mapfile -t CHANGED_FILES < <(
  {
    git diff --name-only "$BASE_REF...HEAD"
    git diff --name-only --cached
    git diff --name-only
    git ls-files --others --exclude-standard
  } | awk 'NF' | sort -u
)

echo "== Git Status =="
git status --short
echo

echo "== Changed Files =="
if [[ ${#CHANGED_FILES[@]} -eq 0 ]]; then
  echo "(none)"
else
  printf '%s\n' "${CHANGED_FILES[@]}"
fi
echo

echo "== Diff Summary vs $BASE_REF =="
git diff --stat "$BASE_REF...HEAD" || true
echo

BLOCKED_PATH_HITS=()
for file in "${CHANGED_FILES[@]}"; do
  case "$file" in
    config/*.local.json|config/generated/*|data/*|downloads/*|output/*|.playwright-cli/*|android/local.properties|android/app/build/*|*.pid|*.log|*logcat*|*ui*.xml)
      BLOCKED_PATH_HITS+=("$file")
      ;;
  esac
done

if [[ ${#BLOCKED_PATH_HITS[@]} -gt 0 ]]; then
  echo "== Blocked Paths (must review or remove before push) =="
  printf '%s\n' "${BLOCKED_PATH_HITS[@]}"
  echo
fi

PATTERN_HITS=0
echo "== Privacy / Secret Pattern Scan =="
while IFS='|' read -r label pattern; do
  [[ -z "$label" ]] && continue
  if MATCHES="$(rg -n --pcre2 -- "$pattern" "$TMP_DIFF" || true)" && [[ -n "$MATCHES" ]]; then
    PATTERN_HITS=1
    echo "-- $label"
    echo "$MATCHES"
    echo
  fi
done <<'EOF'
Non-example email addresses|\b[A-Za-z0-9._%+-]+@(?!example\.com\b|users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b
Preview / access hostnames|[A-Za-z0-9-]+\.trycloudflare\.com|[A-Za-z0-9-]+\.cloudflareaccess\.com
Local machine identifiers|\bDESKTOP-[A-Z0-9]+\b|/home/[A-Za-z0-9._-]+/|C:\\Users\\[A-Za-z0-9._-]+\\
Private network addresses|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b
GitHub tokens|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}
OpenAI-style keys|\bsk-[A-Za-z0-9]{20,}\b
AWS access keys|\bAKIA[0-9A-Z]{16}\b
Private key blocks|-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----
EOF

LOCAL_PATTERNS_FILE=".open-source-safety.local.patterns"
if [[ -f "$LOCAL_PATTERNS_FILE" ]]; then
  echo "== Local Extra Pattern Scan =="
  while IFS= read -r needle; do
    [[ -z "$needle" || "$needle" == \#* ]] && continue
    if MATCHES="$(rg -n -F -- "$needle" "$TMP_DIFF" || true)" && [[ -n "$MATCHES" ]]; then
      PATTERN_HITS=1
      echo "-- $needle"
      echo "$MATCHES"
      echo
    fi
  done <"$LOCAL_PATTERNS_FILE"
fi

if [[ $PATTERN_HITS -eq 0 ]]; then
  echo "(no matches)"
fi
echo

echo "== Recommended Next Commands =="
echo "git diff --cached --stat"
echo "git diff --cached"
echo "git push"
echo

if [[ ${#BLOCKED_PATH_HITS[@]} -gt 0 || $PATTERN_HITS -ne 0 ]]; then
  echo "Open-source safety check: REVIEW REQUIRED"
  exit 1
fi

echo "Open-source safety check: OK"
