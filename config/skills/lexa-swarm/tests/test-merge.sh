#!/usr/bin/env bash
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Repo with lanes, manifest, per-lane commits, ledger approvals.
git -C "$TMP" init -q -b main
git -C "$TMP" commit -q --allow-empty -m init
mkdir -p "$TMP/wireframes" "$TMP/app" "$TMP/server" "$TMP/cli" "$TMP/docs"
REPO="$TMP" FEATURE=test-lane WT_BASE="$TMP/wts" \
  bash "$TEST_DIR/../scripts/make-worktrees.sh" >/dev/null
for b in be wf fe cli docs; do
  git -C "$TMP/wts/lexa-$b" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "$b work"
done
approve() { echo "Lane $1: review clean (commits abc..def)" >> "$TMP/status/ledger.md"; }

# Negative: no approvals -> exit nonzero, nothing merged.
if REPO="$TMP" FEATURE=test-lane GATE_CMD=true bash "$TEST_DIR/../scripts/merge-gate.sh" >/dev/null 2>&1; then
  echo "FAIL: merge without any approvals should fail"
  exit 1
fi
[ "$(git -C "$TMP" rev-list --count main)" = "1" ] || { echo "FAIL: main moved without approvals"; exit 1; }

# Partial: only be approved -> be merged, wf skipped, exit nonzero.
approve be
set +e
REPO="$TMP" FEATURE=test-lane GATE_CMD=true bash "$TEST_DIR/../scripts/merge-gate.sh" >/dev/null 2>&1
rc=$?
set -e
[ $rc -eq 4 ] || { echo "FAIL: expected exit 4 (blocked lanes), got $rc"; exit 1; }
git -C "$TMP" log --oneline main | grep -q "merge(lane): be" || { echo "FAIL: be not merged"; exit 1; }
git -C "$TMP" log --oneline main | grep -q "merge(lane): wf" && { echo "FAIL: wf merged without approval"; exit 1; }

# Full: approve all -> exit 0, all merged in order.
for b in wf fe cli docs; do approve "$b"; done
REPO="$TMP" FEATURE=test-lane GATE_CMD=true bash "$TEST_DIR/../scripts/merge-gate.sh" >/dev/null
order=$(git -C "$TMP" log --format=%s --reverse main | grep -c '^merge(lane)')
[ "$order" = "5" ] || { echo "FAIL: expected 5 merges, got $order"; exit 1; }
echo "PASS"
