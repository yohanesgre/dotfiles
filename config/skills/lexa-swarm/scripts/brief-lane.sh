#!/usr/bin/env bash
# brief-lane.sh — extract one lane's task from status/PLAN.md into the lane's
# brief file. The brief is the lane's single source of requirements (SDD
# principle): the dispatch prompt never pastes the task text.
#
# PLAN.md format: a top-level `## Lane: <name>` heading; the section body
# (until the next `## Lane:` or `## ` heading of equal/higher level) is the
# brief. Lanes without a section get an explicit warning so the orchestrator
# never dispatches a brief-less lane.
#
# Usage: brief-lane.sh REPO LANE
# Writes: <repo>/status/briefs/<lane>.md
set -euo pipefail
REPO="${1:?usage: brief-lane.sh REPO LANE}"
LANE="${2:?usage: brief-lane.sh REPO LANE}"
PLAN="$REPO/status/PLAN.md"
[ -f "$PLAN" ] || { echo "no $PLAN — orchestrator must write the plan first" >&2; exit 2; }

OUT="$REPO/status/briefs/$LANE.md"
mkdir -p "$(dirname "$OUT")"

awk -v lane="$LANE" '
  /^#+[ \t]+Lane:[ \t]+/ {
    # section header: starts a lane section
    name = $0
    sub(/^#+[ \t]+Lane:[ \t]+/, "", name)
    sub(/[ \t]+$/, "", name)
    insection = (name == lane)
    printed = 0
    next
  }
  insection && /^#+[ \t]/ {
    # any heading ends the current lane section
    insection = 0
  }
  insection { print; printed = 1 }
' "$PLAN" > "$OUT"

if [ ! -s "$OUT" ]; then
  echo "no '## Lane: $LANE' section in $PLAN — write it before dispatching" >&2
  exit 3
fi

echo "brief: $OUT ($(wc -l < "$OUT" | tr -d ' ') lines)"
