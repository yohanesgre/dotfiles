#!/usr/bin/env bash
# prune.sh — delete merged swarm branches, ancestry-checked (never
# timer-based). Dry-run by default.
#
# Usage: prune.sh REPO [FEATURE]   (FEATURE optional: prune one feature)
# Env:  LEXA_SWARM_PRUNE=yes   actually delete (dry-run otherwise)
set -euo pipefail
REPO="${1:?usage: prune.sh REPO [FEATURE]}"
FEATURE="${2:-}"

echo "== merged swarm branches (dry-run; LEXA_SWARM_PRUNE=yes to delete) =="
found=0
# NOTE: for-each-ref '*' does not cross '/' — 'refs/heads/swarm/*' misses
# nested refs like swarm/<feature>/<lane>. Use the prefix form instead.
for br in $(git -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads/swarm); do
  if [ -n "$FEATURE" ] && [[ "$br" != "swarm/$FEATURE/"* ]]; then
    continue
  fi
  # branch fully merged into main (ancestry test, not date)
  if git -C "$REPO" merge-base --is-ancestor "$br" main 2>/dev/null; then
    echo "merged: $br"
    found=1
    if [ "${LEXA_SWARM_PRUNE:-}" = "yes" ]; then
      git -C "$REPO" branch -D "$br"
    fi
  else
    echo "keep (not merged): $br"
  fi
done
[ $found -eq 1 ] || echo "(nothing to prune)"
