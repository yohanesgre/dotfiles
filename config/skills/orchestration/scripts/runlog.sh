#!/usr/bin/env bash
# Orchestration run log — append ONE compact JSON line per event.
# ALWAYS-ON but ADVISORY: any failure here must NEVER fail a lane/run, so
# every step is non-fatal (guard on jq, swallow errors, exit 0).
#
# usage: runlog.sh <kind> key=value [key=value ...]
#   kind  "lane" (one per dispatched lane) | "plan" (one per plan close-out)
#   ts    added automatically (UTC ISO-8601); keys with no '=' are ignored.
#   repo  added automatically (MAIN repo name); reserved, callers cannot override.
#
# log path: CENTRAL — $ORCH_LOG, else $HOME/.local/state/orchestration/runs.jsonl
# (one log for ALL projects). `repo` (worktree-correct) attributes each event.
set -uo pipefail

KIND=${1:-}
if [ -z "$KIND" ]; then
  echo "runlog.sh: usage: runlog.sh <kind> key=value [key=value ...]" >&2
  exit 0
fi
shift

command -v jq >/dev/null 2>&1 || exit 0

# --git-common-dir is relative (".git") in the main worktree -> fall back to
# show-toplevel; absolute in a linked worktree -> its dirname IS the main root.
# REPO = basename of that MAIN root: a lane in .worktrees/<plan>-<lane> still
# logs the main repo name, not the worktree name.
COMMON=$(git rev-parse --git-common-dir 2>/dev/null) || COMMON=""
case "$COMMON" in
  /*) ROOT=$(dirname "$COMMON") ;;
  *)  ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || ROOT="" ;;
esac
REPO=$(basename "${ROOT:-$PWD}")

LOG=${ORCH_LOG:-"$HOME/.local/state/orchestration/runs.jsonl"}

# A RELATIVE ORCH_LOG must NOT be resolved against the caller's cwd: lane
# runners cd into their lane worktree, so the same value would scatter events
# across directories. Resolve it against the MAIN repo root (absolute untouched).
if [ -n "${ORCH_LOG:-}" ]; then
  case "$LOG" in /*) ;; *) LOG="$ROOT/$LOG" ;; esac
fi
mkdir -p "$(dirname "$LOG")" 2>/dev/null || exit 0

args=(--arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg kind "$KIND" --arg repo "$REPO")
for kv in "$@"; do
  key=${kv%%=*}
  [ "$key" = "$kv" ] && continue                       # no '=' -> skip
  case "$key" in ts|kind|repo) continue ;; esac        # reserved
  case "$key" in ''|*[!A-Za-z0-9_]*) continue ;; esac  # jq --arg needs a safe name
  args+=(--arg "$key" "${kv#*=}")
done

# $ARGS.named = every --arg as one object; jq does ALL escaping (no hand-rolling)
line=$(jq -nc "${args[@]}" '$ARGS.named' 2>/dev/null) || exit 0
[ -n "$line" ] || exit 0
printf '%s\n' "$line" >> "$LOG" 2>/dev/null || true
exit 0
