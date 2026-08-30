#!/usr/bin/env bash
# wait-lane.sh — block until a lane agent finishes its turn.
#
# Why not `herdr agent wait`? Empirical: it matches the agent's state AT CALL
# TIME and misses working→idle transitions (a wait started while the lane is
# working can hang forever even after it goes idle). This loop polls the
# agent state + the lane's status file + worktree changes and exits when the
# lane is idle AND produced output, or on timeout. Run it as ONE blocking
# call so the orchestrator's continuation never breaks.
set -euo pipefail
LANE="${1:?usage: wait-lane.sh <lane> [timeout-minutes]}"
TIMEOUT_MIN="${2:-30}"
WT="${WT:-$HOME/projects/lexa-$LANE}"
STATUS="${STATUS:-$HOME/projects/lexa/status/$LANE.md}"
START_TS="$(date +%s)"
STATE_FILE_SNAPSHOT="$(cat "$STATUS" 2>/dev/null || true)"
WORKTREE_SNAPSHOT="$(git -C "$WT" status --short 2>/dev/null || true)"

echo "waiting for lane '$LANE' (timeout ${TIMEOUT_MIN}m)"
while true; do
  NOW="$(date +%s)"
  [ $((NOW - START_TS)) -gt $((TIMEOUT_MIN * 60)) ] && { echo "TIMEOUT: lane $LANE did not finish in ${TIMEOUT_MIN}m"; exit 1; }

  AGENT_STATE="$(herdr agent list 2>/dev/null \
    | bun -e 'const d=JSON.parse(await Bun.stdin.text()); const a=(d.result?.agents||[]).find(x=>x.name===process.argv[1]); console.log(a?.agent_status ?? "unknown");' "$LANE" 2>/dev/null || echo unknown)"
  STATE_FILE_NOW="$(cat "$STATUS" 2>/dev/null || true)"
  WORKTREE_NOW="$(git -C "$WT" status --short 2>/dev/null || true)"

  # Lane is idle AND produced something (status file changed, or worktree
  # gained changes) → done. Idle without any output = prompt never started.
  if [ "$AGENT_STATE" = "idle" ] || [ "$AGENT_STATE" = "done" ]; then
    if [ "$STATE_FILE_NOW" != "$STATE_FILE_SNAPSHOT" ] || [ "$WORKTREE_NOW" != "$WORKTREE_SNAPSHOT" ]; then
      echo "lane $LANE finished: state=$AGENT_STATE"
      exit 0
    fi
    echo "WARN: lane $LANE idle with NO new output — prompt may not have started; still waiting (see gotcha 6)"
  fi
  sleep 15
done
