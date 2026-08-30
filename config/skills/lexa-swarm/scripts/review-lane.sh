#!/usr/bin/env bash
# review-lane.sh — build a review package for one lane: commit list, stat
# summary, and the net diff base..branch with extended context, written to
# a file the reviewer reads in one call (SDD review-package adapted to lanes).
# Base comes from the swarm manifest (first fanout SHA), never HEAD~1.
#
# Usage: review-lane.sh REPO LANE [LANE2 ...]
# Writes: <repo>/status/reviews/<lane>.md  (re-review = run again, it
# overwrites with the CURRENT base..branch state)
set -euo pipefail
REPO="${1:?usage: review-lane.sh REPO LANE [LANE2 ...]}"
shift
[ $# -ge 1 ] || { echo "usage: review-lane.sh REPO LANE [LANE2 ...]" >&2; exit 2; }
MANIFEST="$REPO/status/swarm.json"
[ -f "$MANIFEST" ] || { echo "no $MANIFEST — run make-worktrees.sh first" >&2; exit 2; }

BASE="$(bun -e 'const m=JSON.parse(await Bun.stdin.text()); console.log(m.base)' < "$MANIFEST")"
mkdir -p "$REPO/status/reviews"

for lane in "$@"; do
  BRANCH="$(bun -e "const m=JSON.parse(await Bun.stdin.text()); const l=m.lanes['$lane']; console.log(l ? l.branch : '')" < "$MANIFEST")"
  [ -n "$BRANCH" ] || { echo "no lane '$lane' in manifest" >&2; exit 2; }
  git -C "$REPO" rev-parse --verify --quiet "$BRANCH" >/dev/null \
    || { echo "no branch $BRANCH for lane $lane" >&2; exit 2; }

  OUT="$REPO/status/reviews/$lane.md"
  {
    echo "# Review package: $lane ($BASE..$BRANCH)"
    echo
    echo "## Commits"
    git -C "$REPO" log --oneline "$BASE..$BRANCH"
    echo
    echo "## Files changed"
    git -C "$REPO" diff --stat "$BASE..$BRANCH"
    echo
    echo "## Diff"
    git -C "$REPO" diff -U10 "$BASE..$BRANCH"
  } > "$OUT"
  echo "review package: $OUT ($(git -C "$REPO" rev-list --count "$BASE..$BRANCH") commits, $(wc -c < "$OUT" | tr -d ' ') bytes)"
done
