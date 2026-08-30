#!/usr/bin/env bash
# make-worktrees.sh — one git worktree per lane + swarm manifest.
#
# Writes status/swarm.json at the main checkout: the fanout fork base SHA
# and one record per lane (branch, worktree path, brief/report/status paths).
# Everything later (review-lane.sh, merge-gate.sh, prune.sh) reads this
# manifest — never derives base from HEAD~1.
#
# Re-runs are safe: existing worktrees/branches are reused, base stays the
# FIRST fanout SHA (drift checks rely on it).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lanes.conf"
REPO="${REPO:?set REPO to the main checkout}"
FEATURE="${FEATURE:?set FEATURE to a feature slug}"
WT_BASE="${WT_BASE:-$HOME}"

STATUS_DIR="$REPO/status"
MANIFEST="$STATUS_DIR/swarm.json"
mkdir -p "$STATUS_DIR"

BASE="$(git -C "$REPO" rev-parse main)"
if [ -f "$MANIFEST" ]; then
  OLD_BASE="$(bun -e 'const m=JSON.parse(await Bun.stdin.text()); console.log(m.base)' < "$MANIFEST" 2>/dev/null || echo "")"
  [ "$OLD_BASE" = "$BASE" ] || { echo "ERROR: manifest base $OLD_BASE != current main $BASE — main moved since fanout; re-plan or start a new feature" >&2; exit 1; }
fi

for lane in "${LANES[@]}"; do
  name="${lane%%:*}"
  rest="${lane#*:}"
  wt="${rest%%:*}"
  [ "$name" = dev ] && continue
  path="$WT_BASE/$wt"
  if [ ! -d "$path/.git" ]; then
    git -C "$REPO" worktree add -b "swarm/$FEATURE/$name" "$path" main
  fi
  # Reuse must be the SAME repo's worktree — a stale dir from another repo
  # silently edits nothing (gotcha 4/6). Refuse loudly instead.
  # NOTE: --git-common-dir alone is relative in the main checkout but
  # absolute in linked worktrees — normalize with --path-format=absolute.
  wt_common="$(git -C "$path" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")"
  main_common="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)"
  [ "$wt_common" = "$main_common" ] \
    || { echo "ERROR: $path is not a worktree of $REPO — remove it first" >&2; exit 1; }
  echo "$name $path"
done

# Deterministic manifest rebuild (lanes.conf is the single source of truth;
# base stays the first fanout SHA).
{
  echo "{"
  echo "  \"feature\": \"$FEATURE\","
  echo "  \"base\": \"$BASE\","
  echo "  \"lanes\": {"
  first=1
  for lane in "${LANES[@]}"; do
    name="${lane%%:*}"
    rest="${lane#*:}"
    wt="${rest%%:*}"
    [ "$name" = dev ] && continue
    [ $first -eq 1 ] || echo ","
    first=0
    printf '    "%s": {"branch": "swarm/%s/%s", "worktree": "%s", "brief": "%s/briefs/%s.md", "report": "%s/reports/%s.md", "review": "%s/reviews/%s.md", "status": "%s/%s.md"}' \
      "$name" "$FEATURE" "$name" "$WT_BASE/$wt" \
      "$STATUS_DIR" "$name" "$STATUS_DIR" "$name" "$STATUS_DIR" "$name" "$STATUS_DIR" "$name"
  done
  echo ""
  echo "  }"
  echo "}"
} > "$MANIFEST"
echo "manifest: $MANIFEST (base $BASE)"
