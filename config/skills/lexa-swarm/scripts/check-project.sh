#!/usr/bin/env bash
# check-project.sh — lexa-project guardrail.
#
# The lane scopes, wireframe-first gate, contract ownership, and per-lane
# AGENTS.md texts are written FOR the lexa repo layout (app/, server/, cli/,
# docs/, wireframes/ submodule, shared/types.ts, dev:full). Running the
# swarm on a repo without that shape silently produces nonsense lanes.
#
# Orchestrator rule: run this FIRST. If it exits nonzero, warn the user and
# ask before continuing. Non-interactive bypass: LEXA_SWARM_ALLOW_NON_LEXA=1.
#
# Usage: check-project.sh [REPO]   (REPO env fallback)
set -u
REPO="${1:-${REPO:-}}"
[ -n "$REPO" ] || { echo "ERROR: set REPO (usage: check-project.sh [REPO])" >&2; exit 2; }
[ -d "$REPO/.git" ] || { echo "ERROR: $REPO is not a git repo" >&2; exit 2; }

ok=1
check_dir() { # $1 relative path
  if [ -d "$REPO/$1" ]; then
    echo "ok:   $1/"
  else
    echo "MISS: $1/  (lane scope dir)"
    ok=0
  fi
}

echo "== lexa-shape check: $REPO =="
for d in wireframes app server cli docs shared migrations; do
  check_dir "$d"
done
if grep -q '"dev:full"' "$REPO/package.json" 2>/dev/null; then
  echo "ok:   package.json dev:full script"
else
  echo "MISS: package.json 'dev:full' script (dev-server lane runs it)"
  ok=0
fi
if [ -f "$REPO/AGENTS.md" ]; then
  echo "ok:   AGENTS.md (lane agents re-read it for invariants)"
else
  echo "MISS: AGENTS.md (lanes are told to re-read lexa invariants from it)"
  ok=0
fi

if [ $ok -eq 1 ]; then
  echo "== lexa-shaped; proceed =="
  exit 0
fi
echo "== NOT lexa-shaped: lane scopes/gates/AGENTS.md texts assume the lexa layout. ==" >&2
if [ "${LEXA_SWARM_ALLOW_NON_LEXA:-}" = "1" ]; then
  echo "== LEXA_SWARM_ALLOW_NON_LEXA=1: continuing anyway ==" >&2
  exit 0
fi
echo "== Ask the user for consent before continuing; set LEXA_SWARM_ALLOW_NON_LEXA=1 to bypass. ==" >&2
exit 1
