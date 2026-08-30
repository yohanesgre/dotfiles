#!/usr/bin/env bash
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q -b main
git -C "$TMP" commit -q --allow-empty -m init
git -C "$TMP" checkout -q -b swarm/x/merged
git -C "$TMP" commit -q --allow-empty -m m
git -C "$TMP" checkout -q main
git -C "$TMP" merge -q --no-ff swarm/x/merged -m merge
git -C "$TMP" checkout -q -b swarm/x/unmerged
git -C "$TMP" commit -q --allow-empty -m u
git -C "$TMP" checkout -q main

# Dry-run: lists merged, keeps both branches.
out=$(bash "$TEST_DIR/../scripts/prune.sh" "$TMP")
case "$out" in *"merged: swarm/x/merged"*) ;; *) echo "FAIL: merged branch not listed"; exit 1;; esac
case "$out" in *"keep (not merged): swarm/x/unmerged"*) ;; *) echo "FAIL: unmerged not kept"; exit 1;; esac
git -C "$TMP" rev-parse -q --verify swarm/x/merged >/dev/null || { echo "FAIL: dry-run deleted branch"; exit 1; }

# Env-gated: deletes only the merged one.
LEXA_SWARM_PRUNE=yes bash "$TEST_DIR/../scripts/prune.sh" "$TMP" >/dev/null
! git -C "$TMP" rev-parse -q --verify swarm/x/merged >/dev/null || { echo "FAIL: merged branch not deleted"; exit 1; }
git -C "$TMP" rev-parse -q --verify swarm/x/unmerged >/dev/null || { echo "FAIL: unmerged branch deleted"; exit 1; }
echo "PASS"
