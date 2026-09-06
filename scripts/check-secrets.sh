#!/usr/bin/env bash
# check-secrets.sh — fail fast if real secrets staged or tracked.
# Usage:
#   bash scripts/check-secrets.sh --staged   # pre-commit: staged files only
#   bash scripts/check-secrets.sh            # validate/CI: all tracked files
# Prints file:line + pattern only (never line content).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

STAGED=false
[ "${1:-}" = "--staged" ] && STAGED=true

# Files that must never enter git (match .gitignore + key material)
BLOCKED_RE='^(\.env\.toml|\.env|.*\.env\.toml\.local|\.env\.toml\.local|\.chezmoi\.toml|.*\.pem|.*\.key|config/private/.*)$'

# Real-secret patterns (min length avoids placeholders like sk-..., ghp_..., xoxp-...)
SECRET_RES=(
  'MT[A-Za-z0-9_.-]{10,}\.[A-Za-z0-9_.-]{5,}\.[A-Za-z0-9_.-]{10,}|DISCORD_TOKEN'
  'sk-[A-Za-z0-9]{20,}|SK_SECRET'
  'ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}'
  'AKIA[0-9A-Z]{16}|aws_secret_access_key'
  'xox[baprs]-[A-Za-z0-9-]{10,}'
  'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY'
)
# Lines with these markers are docs/placeholders, not secrets
PLACEHOLDER_RE='REPLACE_WITH|your_|example|placeholder|\.\.\.'

FAILED=0

if [ "$STAGED" = true ]; then
  FILES=$(git diff --cached --name-only -z --diff-filter=ACM 2>/dev/null | tr '\0' '\n' || true)
  [ -z "$FILES" ] && { echo "check-secrets: no staged files"; exit 0; }
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if echo "$f" | grep -qE "$BLOCKED_RE"; then
      echo "BLOCKED staged file: $f (gitignored secret — unstage it)"
      FAILED=1
      continue
    fi
    [ -f "$f" ] || continue
    for re in "${SECRET_RES[@]}"; do
      HITS=$(grep -n -E "$re" "$f" 2>/dev/null | grep -v -E "$PLACEHOLDER_RE" | cut -d: -f1 || true)
      for ln in $HITS; do
        echo "SECRET pattern in staged $f:$ln [$re]"
        FAILED=1
      done
    done
  done <<< "$FILES"
else
  # self-exclusion: this script contains its own patterns as regex literals
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ "$f" = "scripts/check-secrets.sh" ] && continue
    echo "$f" | grep -qE "$BLOCKED_RE" && { echo "TRACKED blocked file: $f"; FAILED=1; continue; }
    for re in "${SECRET_RES[@]}"; do
      HITS=$(git grep -n -E "$re" -- "$f" 2>/dev/null | grep -v -E "$PLACEHOLDER_RE" | cut -d: -f2 || true)
      for ln in $HITS; do
        echo "SECRET pattern in tracked $f:$ln [$re]"
        FAILED=1
      done
    done
  done <<< "$(git ls-files | grep -v -E '^config/skills/(claude-api|cloudflare|canvas-design|ui-styling)/' || true)"
  # skills vendor docs carry doc placeholders (ghp_your_, xoxp-...) — covered by
  # placeholder filter, but excluded here to keep signal clean; spot-check them:
  SKILL_HITS=$(git grep -n -E 'sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|MT[A-Za-z0-9_.-]{10,}\.[A-Za-z0-9_.-]{5,}' -- config/skills/ 2>/dev/null | grep -v -E "$PLACEHOLDER_RE" || true)
  if [ -n "$SKILL_HITS" ]; then
    echo "$SKILL_HITS" | cut -d: -f1,2 | while IFS= read -r loc; do echo "SECRET pattern in tracked $loc"; done
    FAILED=1
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  echo "check-secrets: FAIL — redaksi dulu sebelum commit"
  exit 1
fi
echo "check-secrets: PASS"
