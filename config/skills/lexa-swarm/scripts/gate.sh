#!/usr/bin/env bash
set -euo pipefail
REPO="${REPO:?set REPO to the repo root}"
GATE_TSC="${GATE_TSC:-$REPO/node_modules/.bin/tsc}"
GATE_VITEST="${GATE_VITEST:-$REPO/node_modules/.bin/vitest}"

fail=0
run_gate() {
  local name="$1"; shift
  local out
  if ! out=$("$@" 2>&1); then
    echo "GATE FAILED: $name" >&2
    echo "$out" | tail -20 >&2
    fail=1
  else
    echo "gate ok: $name"
  fi
}

run_gate "tsc --noEmit" bash -c "cd '$REPO' && '$GATE_TSC' --noEmit"
run_gate "vitest run" bash -c "cd '$REPO' && '$GATE_VITEST' run"
run_gate "wireframes build" bash -c "cd '$REPO' && bash wireframes/build.sh"

exit $fail
