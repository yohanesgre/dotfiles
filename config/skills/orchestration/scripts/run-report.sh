#!/usr/bin/env bash
# Aggregate the orchestration CENTRAL run log
# ($HOME/.local/state/orchestration/runs.jsonl) into a markdown report.
# Read-only + ADVISORY — never fails a lane/run.
#
# usage: run-report.sh [log-file] [out-file]
#   log-file  $ORCH_LOG, else $1, else the central default (all repos)
#             a RELATIVE $ORCH_LOG resolves against the MAIN repo root (lane
#             runners cd into worktrees); a relative $1 stays cwd-relative.
#   out-file  default: stdout only
#   ORCH_REPO env  filter to one repo (empty/unset = all repos)
set -uo pipefail

command -v jq >/dev/null 2>&1 || { echo "run-report.sh: jq not found" >&2; exit 0; }

LOG=${ORCH_LOG:-${1:-"$HOME/.local/state/orchestration/runs.jsonl"}}

# MAIN repo root (worktree-correct): --git-common-dir is relative (".git") in
# the main worktree -> show-toplevel; absolute in a linked worktree -> dirname.
if [ -n "${ORCH_LOG:-}" ]; then
  case "$(git rev-parse --git-common-dir 2>/dev/null || true)" in
    /*) ROOT=$(dirname "$(git rev-parse --git-common-dir)") ;;
    *)  ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true) ;;
  esac
  ROOT=${ROOT:-$PWD}
  case "$LOG" in /*) ;; *) LOG="$ROOT/$LOG" ;; esac
fi
OUT=${2:-}
REPO_F=${ORCH_REPO:-}

if [ ! -s "$LOG" ]; then
  echo "no runs logged yet"
  exit 0
fi

# shared jq helpers: every logged field is a STRING -> cast explicitly.
# rc/dur absent or unparseable must not abort the whole report.
# $repo (--arg) applies the ORCH_REPO filter to every section.
JQ_DEFS='
  def rcnum: ((.rc // "0") | tonumber? // -1);
  def dur_s: (if .dur_s != null then (.dur_s | tonumber?)
              else (((.dur_ms // "0") | tonumber?) / 1000) end // 0);
  def rkeep: ($repo == "") or (.repo == $repo);
'

gen() {
  echo "# Orchestration run report"
  echo
  echo "source: $LOG · repo: ${REPO_F:-all} · generated: $(date -u +%Y-%m-%dT%H:%MZ) · entries: $(wc -l < "$LOG")"
  echo
  echo "## Lanes by repo/plan (kind=lane)"
  echo
  echo "| repo | plan | n | rc=0 | rc!=0 | mean dur | max dur |"
  echo "|---|---|---|---|---|---|---|"
  jq -rs --arg repo "$REPO_F" "$JQ_DEFS"'
    [.[] | select(.kind=="lane") | select(rkeep)] | group_by([.repo, .plan])[] |
    .[0].repo as $r | .[0].plan as $p |
    "| \($r) | \($p) | \(length) | \([.[]|select(rcnum==0)]|length) | \([.[]|select(rcnum!=0)]|length) | \((map(dur_s)|add/length*10|round/10))s | \((map(dur_s)|max*10|round/10))s |"
  ' "$LOG"
  echo
  echo "## Plans (kind=plan)"
  echo
  echo "| repo | plan | verdict | wall_s | lanes | prs | iter |"
  echo "|---|---|---|---|---|---|---|"
  jq -rs --arg repo "$REPO_F" "$JQ_DEFS"'[.[] | select(.kind=="plan") | select(rkeep)][] |
    "| \(.repo) | \(.plan) | \(.verdict) | \(.wall_s) | \(.lanes) | \(.prs) | \(.iter) |"' "$LOG"
  echo
  echo "## Failures (lanes rc!=0, plans verdict != DONE)"
  echo
  jq -rs --arg repo "$REPO_F" "$JQ_DEFS"'
    [.[] | select(rkeep) | select((.kind=="lane" and rcnum!=0) or (.kind=="plan" and .verdict != "DONE"))] |
    if length==0 then "- none"
    else (.[] | "- \(.repo)/\(.plan // "-")/\(.lane // "-"): \(if .rc != null then "rc=\(.rc)" else "verdict=\(.verdict)" end)")
    end
  ' "$LOG"
  echo
  echo "## Signals (improve/fix candidates)"
  echo
  jq -rs --arg repo "$REPO_F" "$JQ_DEFS"'
    ([.[] | select(.kind=="lane") | select(rkeep) | select(rcnum!=0)]
      | group_by([.repo,.plan,.lane])
      | map(select(length>=2))
      | sort_by([.[0].repo,.[0].plan,.[0].lane])
      | map("- repeated: \(.[0].repo)/\(.[0].plan // "-")/\(.[0].lane // "-") (\(length))"))
    +
    ([.[] | select(.kind=="plan") | select(rkeep) | select(((.iter // "0") | tonumber?) > 1)]
      | sort_by([.repo,.plan])
      | map("- \(.repo)/\(.plan) iter=\(.iter)"))
    | if length == 0 then "- none" else .[] end
  ' "$LOG"
  echo
  echo "## Slowest lanes (top 10)"
  echo
  jq -rs --arg repo "$REPO_F" "$JQ_DEFS"'
    [.[] | select(.kind=="lane") | select(rkeep)] | sort_by(dur_s) | reverse | .[0:10][] |
    "- \(.repo)/\(.plan // "-")/\(.lane // "-"): \(((dur_s)*10|round/10))s rc=\(.rc // "?")"
  ' "$LOG"
  echo
  echo "## Recent fixes (kind=fix)"
  echo
  jq -rs --arg repo "$REPO_F" "$JQ_DEFS"'
    [.[] | select(.kind=="fix") | select(rkeep)] | .[-10:] | reverse |
    map("- \(.repo)/\(.plan // "-"): \(.symptom // "-") — \(.change // "-") (\(.ts // "-"))")
    | if length == 0 then "- none" else .[] end
  ' "$LOG"
}

if [ -n "$OUT" ]; then
  mkdir -p "$(dirname "$OUT")" 2>/dev/null || true
  gen > "$OUT"
  cat "$OUT"
else
  gen
fi
