#!/usr/bin/env bash
# merge-gate.sh — integrate lanes contract-first, but ONLY lanes whose
# review passed (SDD gate). Per-lane try/catch: one conflicted lane does not
# kill the run — it is reported and the rest continue.
#
# Preconditions per lane (from the ledger, not trust):
#   - ledger line 'Lane <lane>: review clean'  OR
#   - ledger line 'Lane <lane>: complete (<n> parked)'  (breaker adjudicated)
#   - branch exists in the manifest
# A lane without an approval line is SKIPPED and the run exits nonzero.
#
# Usage: merge-gate.sh  (REPO, FEATURE, GATE_CMD env)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lanes.conf"
REPO="${REPO:?set REPO to the main checkout}"
FEATURE="${FEATURE:?set FEATURE to the feature slug}"
GATE_CMD="${GATE_CMD:-bash \"$SCRIPT_DIR/gate.sh\"}"
MANIFEST="$REPO/status/swarm.json"
LEDGER="$REPO/status/ledger.md"
ORDER=(be wf fe cli docs)

[ -f "$MANIFEST" ] || { echo "no $MANIFEST — run make-worktrees.sh first" >&2; exit 2; }
[ -f "$LEDGER" ] || { echo "no $LEDGER — no lane has been reviewed; refusing to merge" >&2; exit 2; }
BASE="$(bun -e 'const m=JSON.parse(await Bun.stdin.text()); console.log(m.base)' < "$MANIFEST")"

approval() { # $1 lane -> 0 if ledger approves, 1 otherwise
  grep -qE "^Lane ${1}: (review clean|complete \([0-9]+ parked\))" "$LEDGER"
}

merged=0
failures=()
for lane in "${ORDER[@]}"; do
  BRANCH="$(bun -e "const m=JSON.parse(await Bun.stdin.text()); const l=m.lanes['$lane']; console.log(l ? l.branch : '')" < "$MANIFEST")"
  if [ -z "$BRANCH" ] || ! git -C "$REPO" rev-parse --verify -q "$BRANCH" >/dev/null; then
    echo "skip $lane (no branch)"
    continue
  fi
  if ! approval "$lane"; then
    echo "SKIP $lane: no review approval in $LEDGER (review clean / N parked) — merge blocked"
    failures+=("$lane:unreviewed")
    continue
  fi
  echo "== $lane: diff vs main =="
  git -C "$REPO" diff --stat main "$BRANCH" || true
  # Drift check: the lane forked from the recorded base; if main moved
  # past it, say so loudly (rebase onto main before merging is the owner's
  # job; herdr-swarm does CAS — we do detect-and-report).
  MB="$(git -C "$REPO" merge-base main "$BRANCH")"
  if [ "$MB" != "$BASE" ] && ! git -C "$REPO" merge-base --is-ancestor "$BASE" main; then
    echo "WARN: main has moved since fanout (base $BASE, merge-base $MB) — merge may conflict"
  fi
  if ! git -C "$REPO" merge --no-ff "$BRANCH" -m "merge(lane): $lane ($FEATURE)"; then
    echo "CONFLICT on $lane — aborting that merge only"
    git -C "$REPO" merge --abort || true
    failures+=("$lane:conflict")
    continue
  fi
  merged=$((merged + 1))
done

if [ ${#failures[@]} -gt 0 ]; then
  echo "BLOCKED lanes:" >&2
  printf '  %s\n' "${failures[@]}" >&2
fi

echo "== gate =="
if ! bash -c "cd '$REPO' && $GATE_CMD"; then
  echo "GATE FAILED after merge" >&2
  exit 3
fi

if [ ${#failures[@]} -gt 0 ]; then
  echo "merge-gate done: $merged merged, ${#failures[@]} blocked ($(IFS=,; echo "${failures[*]}"))" >&2
  exit 4
fi
echo "merge-gate done: $merged lanes merged, gate green"
