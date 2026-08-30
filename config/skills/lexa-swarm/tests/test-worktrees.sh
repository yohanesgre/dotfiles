#!/usr/bin/env bash
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git -C "$TMP" init -q -b main
git -C "$TMP" commit -q --allow-empty -m init
mkdir -p "$TMP/wireframes" "$TMP/app" "$TMP/server" "$TMP/cli" "$TMP/docs"
REPO="$TMP" FEATURE=test-lane WT_BASE="$TMP/wts" \
  bash "$TEST_DIR/../scripts/make-worktrees.sh"
[ -f "$TMP/status/swarm.json" ] || { echo "FAIL: manifest missing"; exit 1; }
[ "$(bun -e 'const m=JSON.parse(await Bun.stdin.text()); console.log(m.base)' < "$TMP/status/swarm.json")" = "$(git -C "$TMP" rev-parse main)" ] \
  || { echo "FAIL: manifest base wrong"; exit 1; }
[ "$(bun -e 'const m=JSON.parse(await Bun.stdin.text()); console.log(m.lanes.be.branch)' < "$TMP/status/swarm.json")" = "swarm/test-lane/be" ] \
  || { echo "FAIL: lane record wrong"; exit 1; }
[ -d "$TMP/wts/lexa-wf" ] || { echo "FAIL: wf worktree missing"; exit 1; }
branch=$(git -C "$TMP/wts/lexa-wf" rev-parse --abbrev-ref HEAD)
case "$branch" in swarm/test-lane/wf*) ;; *) echo "FAIL: wrong branch $branch"; exit 1;; esac
git -C "$TMP" checkout -q main
git -C "$TMP" commit -q --allow-empty -m moved
if REPO="$TMP" FEATURE=test-lane WT_BASE="$TMP/wts" \
   bash "$TEST_DIR/../scripts/make-worktrees.sh" 2>/dev/null; then
  echo "FAIL: rerun on moved main should abort"
  exit 1
fi
echo "PASS"
