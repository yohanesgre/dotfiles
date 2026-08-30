#!/usr/bin/env bash
# lane-agents.sh — per-lane AGENTS.md with scope, gates, and the SDD
# brief/report contract (each lane's requirements come from a brief FILE;
# the lane writes its full report to a report FILE and replies only with
# status — nothing stays in the orchestrator's context).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lanes.conf"
REPO="${REPO:?set REPO to the main checkout}"
FEATURE="${FEATURE:?set FEATURE to a feature slug}"
WT_BASE="${WT_BASE:-$HOME}"

STATUS_DIR="$REPO/status"

COMMON="## Status protocol + report contract
You are the $FEATURE lane in the lexa-swarm orchestrator.
- Your requirements are the BRIEF file: <repo>/status/briefs/<lane>.md (replace <repo> with $REPO, <lane> with your lane name). Read it FIRST — it is the single source of requirements; the dispatch prompt is only context.
- Lane status: <repo>/status/<lane>.md — 'state: <PLAN|WAIT|WORKING|DONE|FAILED>' + 'ts: <epoch>' + 'msg: <message>'. Heartbeat on every significant action (fresh ts).
- REPORT file: <repo>/status/reports/<lane>.md — write your FULL report there (what you did, tests run with output, deviations, concerns). Reply in the chat ONLY with: state, commit sha, one-line test summary, concerns (if any). Do not paste the report into chat.
- DONE requires: tsc --noEmit green (where applicable) + lane tests + report file written + status file DONE. DONE does NOT mean reviewed — the orchestrator reviews after you.
- If blocked on the BE contract commit, write state: WAIT and stop; the orchestrator pings the BE lane.
- Never touch files outside your lane scope. If you need a backend endpoint or shared type, report it to the orchestrator — never add it yourself.
- No commits unless the orchestrator/user explicitly asks. Do not push. Do not merge.
"

WF="## You are the wf lane (wireframes)
Scope: wireframes/ submodule ONLY.
- Wireframe-first is non-negotiable: your lane must complete BEFORE the FE lane starts.
- Edit wireframes/src/, then run: bash wireframes/build.sh
- All decisions documented as visible annotation notes (<span class=\"annotation\"> / annotation-tag), never HTML comments.
- Never edit wireframes/dist/ directly.
- Gate: bash wireframes/build.sh succeeds and git status in wireframes/ shows your changes.
"

FE="## You are the fe lane (frontend)
Scope: app/ ONLY (routes, components, styles, app/lib). Never: server/, shared/types.ts, docs/, package.json, tsconfig.json, app.config.ts.
- Gates before you may start: wireframe lane DONE (orchestrator confirms) AND BE contract commit exists. Wait otherwise.
- Read the relevant wireframes/src/*.html and transcribe exactly: structure, spacing, copy. Wireframe is source of truth.
- New wireframe CSS classes must be ported into app/styles/phosphor.css.
- TanStack Query for all server state; update cache via setQueryData from mutation responses — never invalidateQueries on the mutation path.
- Verify: tsc --noEmit  (then vitest run if you touched shared/ — you normally don't)
"

BE="## You are the be lane (backend)
Scope: server/, migrations/, and you OWN the shared contract: shared/types.ts + docs/API.md.
- Contract-first: write the contract (shared/types.ts delta + docs/API.md) and report it as your first deliverable; other lanes wait on it.
- Read lexa AGENTS.md invariants before coding: no service-to-service cycles, echo suppression, positions fractional-index, WIP limit in conditional UPDATE, emission invariant, MCP speaks Markdown / REST speaks TipTap JSON.
- Effect-TS everywhere: Effect.Service<Name>()(\"Lexa/Name\", ...); Data.TaggedError; repos thin (prepared statements via bun:sqlite); routes thin (HttpApi groups, declarative .addError).
- Verify: tsc --noEmit && vitest run
"

CLI="## You are the cli lane (lexa-cli)
Scope: cli/ ONLY. Never: server/, app/, docs/, package.json (root), tsconfig.json.
- cli/package.json is the version single source of truth. Keep cli/src/packed.ts a stub unless explicitly shipping a daemon change (say so in the commit).
- CLI wraps the REST API with lxk_ Bearer keys; env fallbacks LEXA_URL / LEXA_API_KEY.
- Verify: tsc --noEmit  and  bun run lexa-cli-dev --help  (boots without error)
"

DOCS="## You are the docs lane
Scope: docs/ ONLY (SCHEMA.md, LAYERS.md, API.md, MCP.md, ARCHITECTURE.md, DEPLOYMENT.md, GITHUB_SETUP.md, CHANGELOG.md).
- Document authority order: SCHEMA > LAYERS > API > MCP > wireframes/DESIGN_SYSTEM > ARCHITECTURE. If docs conflict, STOP and report.
- Keep API.md endpoint shapes exact; keep SCHEMA.md verbatim SQL.
- When the feature lands: add a dated section to CHANGELOG.md (Keep a Changelog format) if the change is user-visible.
- Verify: markdown renders, no broken links to files that don't exist.
"

for lane in "${LANES[@]}"; do
  name="${lane%%:*}"
  rest="${lane#*:}"
  wt="${rest%%:*}"
  [ "$name" = dev ] && continue
  path="$WT_BASE/$wt"
  mkdir -p "$path"
  case "$name" in
    wf)   body="$WF" ;;
    fe)   body="$FE" ;;
    be)   body="$BE" ;;
    cli)  body="$CLI" ;;
    docs) body="$DOCS" ;;
  esac
  printf '%s\n\n%s\n' "$body" "$COMMON" > "$path/AGENTS.md"
  echo "$name $path/AGENTS.md"
done
