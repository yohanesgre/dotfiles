#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lanes.conf"
REPO="${REPO:?set REPO to the main checkout}"
WT_BASE="${WT_BASE:-$HOME}"
DEV_PANE_RUN="${DEV_PANE_RUN:-bun run dev:full}"

# ── Layout contract (learned the hard way) ──────────────────────────────
# - MAX 4 PANES PER TAB (user rule, including nothing else — keep lanes
#   spread across tabs). This script creates: "lanes" (wf/be/cli/docs,
#   equal 2x2 grid), "lanes-fe" (fe, waits for gates), "dev" (dev-server).
# - herdr --ratio takes 0..1 fractions. Passing 50 produces broken
#   0.4/0.9 splits — ALWAYS pass 0.5 and verify rects after each split.
# - Lane panes run `cd <worktree> && opencode`: a bare `opencode` fails
#   with "current working directory was deleted" when the shell's cwd
#   inode went stale (dir removed/recreated by worktree moves).
# - `herdr pane run` sends a command line; it does NOT replace a running
#   TUI. Kill first: send-keys ctrl+c, wait for the shell prompt.

# Create a tab, return its root pane id.
new_tab() { # $1 label, $2 cwd
  herdr tab create --label "$1" --cwd "$2" 2>/dev/null \
    | grep -o '"pane_id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'
}
# Split a pane with an explicit fraction and return the NEW pane id.
split_half() { # $1 pane id, $2 direction, $3 cwd
  herdr pane split "$1" --direction "$2" --ratio 0.5 --cwd "$3" 2>/dev/null \
    | grep -o '"pane_id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"//'
}
# Verify the worktree exists and is a git repo before wiring a pane.
check_wt() { # $1 lane
  local dir="$WT_BASE/lexa-$1"
  [ -d "$dir/.git" ] || [ -d "$dir" ] && git -C "$dir" rev-parse --git-dir >/dev/null 2>&1 \
    || { echo "ERROR: $dir is not a git worktree — run make-worktrees.sh first"; exit 1; }
}
# Launch a lane: rename pane, cd into the worktree, start opencode AS A NAMED
# AGENT (Codex-style) via the herdr opencode integration.
# Prereq: `herdr integration install opencode` (writes
# ~/.config/opencode/plugins/herdr-agent-state.js) — without it, panes are
# anonymous "opencode" processes and `herdr agent list` shows no names.
launch_lane() { # $1 pane id, $2 lane
  local id="$1" lane="$2"
  [ -z "$id" ] && { echo "WARN: no pane id for $lane"; return; }
  check_wt "$lane"
  herdr pane rename "$id" "$lane" >/dev/null 2>&1 || true
  herdr agent start "$lane" --kind opencode --pane "$id" >/dev/null 2>&1 \
    || { echo "WARN: agent start failed for $lane — install the integration first (herdr integration install opencode)"; }
  echo "$lane pane: $id"
}

# Submodule: worktrees do NOT inherit submodule checkouts (git worktree add
# does not run submodule update). The wf lane edits wireframes/ — init it.
git submodule update --init wireframes >/dev/null 2>&1 || true
git -C "$WT_BASE/lexa-wf" submodule update --init wireframes >/dev/null 2>&1 || true

# "lanes" tab — equal 2x2: wf top-left, be bottom-left, cli top-right, docs bottom-right.
WF=$(new_tab lanes "$WT_BASE/lexa-wf")
[ -n "$WF" ] || { echo "ERROR: could not create lanes tab"; exit 1; }
CLI=$(split_half "$WF" right "$WT_BASE/lexa-cli")
BE=$(split_half "$WF" down "$WT_BASE/lexa-be")
DOCS=$(split_half "$CLI" down "$WT_BASE/lexa-docs")
launch_lane "$WF" wf
launch_lane "$BE" be
launch_lane "$CLI" cli
launch_lane "$DOCS" docs

# "lanes-fe" tab — fe waits for the wireframe gate + BE contract commit.
FE=$(new_tab lanes-fe "$WT_BASE/lexa-fe")
launch_lane "$FE" fe

# "dev" tab — dev server for smoke tests (skip if dev:full already running).
if ! pgrep -f "bun run dev:full" >/dev/null 2>&1; then
  DEV=$(new_tab dev "$REPO")
  herdr pane run "$DEV" bash -lc "cd '$REPO' && $DEV_PANE_RUN" >/dev/null 2>&1 || true
  echo "dev pane: $DEV"
else
  echo "dev: dev:full already running, skipped"
fi

echo "layout done: wf $WF be $BE cli $CLI docs $DOCS fe $FE"
echo "verify: herdr pane list | check each pane cwd == $WT_BASE/lexa-*"
