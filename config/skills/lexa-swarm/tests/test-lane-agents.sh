#!/usr/bin/env bash
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/lexa-wf" "$TMP/lexa-fe" "$TMP/lexa-be" "$TMP/lexa-cli" "$TMP/lexa-docs" "$TMP/lexa-dev"
REPO="$TMP" WT_BASE="$TMP" FEATURE=test-lane \
  bash "$TEST_DIR/../scripts/lane-agents.sh"
grep -q "You are the wf lane" "$TMP/lexa-wf/AGENTS.md"
grep -q "tsc --noEmit" "$TMP/lexa-fe/AGENTS.md"
grep -q "server/" "$TMP/lexa-be/AGENTS.md"
grep -q "BRIEF file" "$TMP/lexa-be/AGENTS.md"
grep -q "status/reports" "$TMP/lexa-be/AGENTS.md"
[ ! -f "$TMP/lexa-dev/AGENTS.md" ]
echo "PASS"
