#!/usr/bin/env bash
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
STATUS_DIR="$TMP/status" bash "$TEST_DIR/../scripts/status.sh" report be DONE "contract committed"
grep -q "DONE" "$TMP/status/be.md"
mkdir -p "$TMP/status"
{ echo "state: WAIT"; echo "ts: 1000000000"; echo "msg: stale lane"; } > "$TMP/status/docs.md"
stale_out=$(STATUS_DIR="$TMP/status" bash "$TEST_DIR/../scripts/status.sh" stale 10)
case "$stale_out" in *docs.md*) ;; *) echo "FAIL: stale lane not reported"; exit 1;; esac
case "$stale_out" in *be.md*) echo "FAIL: fresh file reported stale"; exit 1;; esac
echo "PASS"
