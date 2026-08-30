#!/usr/bin/env bash
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Lexa-shaped repo -> exit 0.
mkdir -p "$TMP/lexa/wireframes" "$TMP/lexa/app" "$TMP/lexa/server" "$TMP/lexa/cli" "$TMP/lexa/docs" "$TMP/lexa/shared" "$TMP/lexa/migrations"
printf '{"scripts":{"dev:full":"bash scripts/dev.sh"}}\n' > "$TMP/lexa/package.json"
touch "$TMP/lexa/AGENTS.md"
git -C "$TMP/lexa" init -q -b main 2>/dev/null || true
bash "$TEST_DIR/../scripts/check-project.sh" "$TMP/lexa" >/dev/null || { echo "FAIL: lexa-shaped repo rejected"; exit 1; }

# Not lexa-shaped -> exit 1, and env bypass -> exit 0.
mkdir -p "$TMP/other/src"
git -C "$TMP/other" init -q -b main 2>/dev/null || true
if bash "$TEST_DIR/../scripts/check-project.sh" "$TMP/other" >/dev/null 2>&1; then
  echo "FAIL: non-lexa repo accepted"
  exit 1
fi
LEXA_SWARM_ALLOW_NON_LEXA=1 bash "$TEST_DIR/../scripts/check-project.sh" "$TMP/other" >/dev/null 2>&1 \
  || { echo "FAIL: env bypass did not work"; exit 1; }
echo "PASS"
