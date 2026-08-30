# lexa-swarm

herdr pane orchestration for fullstack Lexa development. One pane per track (wireframes, FE, BE, CLI, docs, dev-server), one git worktree per lane, encoded workflow rules. The orchestration loop is SDD-style (borrowed from superpowers/subagent-driven-development): every lane works from a **brief file**, writes a **report file**, passes a **reviewer gate** with a fix loop, and is recorded in a **ledger** that gates merges. Full spec: the skill's SKILL.md and `~/projects/lexa/docs/private/specs/2026-08-12-lexa-swarm-workflow-design.md`.

## Quickstart

```bash
export REPO=~/projects/lexa FEATURE=<feature-slug>
bash ~/.agents/skills/lexa-swarm/scripts/make-worktrees.sh   # one worktree per lane + status/swarm.json (fork base SHA)
bash ~/.agents/skills/lexa-swarm/scripts/lane-agents.sh      # per-lane AGENTS.md
# in the herdr session:
bash ~/.agents/skills/lexa-swarm/scripts/spawn-layout.sh     # 7 panes, opencode in lane panes
```

Orchestrator stays in the main pane (an opencode session with the skill loaded). Lane panes run their own opencode sessions with scoped AGENTS.md.

## Lifecycle

`plan → wireframe-gate → lanes (brief → work → review → fix loop) → integrate (ledger-gated merge) → release`

- **plan**: orchestrator writes `status/PLAN.md` (`## Lane: <name>` section per lane), then `make-worktrees.sh` writes `status/swarm.json`
- **wireframe-gate**: WF lane completes before FE starts. Never in parallel.
- **lanes**: BE owns the contract (`shared/types.ts` + `docs/API.md`, committed first); FE waits on contract + wireframes; dev pane runs `bun run dev:full`
- **per-lane SDD loop**: `brief-lane.sh` extracts the brief → dispatch → `wait-lane.sh` → read report → `review-lane.sh` + reviewer subagent (`templates/lane-reviewer.md`) → fix loop (resume lane agent rounds 1-3, fresh agent rounds 4-5) → ledger lines
- **integrate**: `merge-gate.sh` merges ONLY ledger-approved lanes, `be → wf → fe → cli → docs`, per-lane conflict isolation, then `gate.sh`
- **release**: both CHANGELOGs, version bumps, wireframes submodule pointer, annotated tags; then `prune.sh` (env-gated)

## Scripts

| Script | Purpose |
|---|---|
| `check-project.sh` | lexa-shape guardrail — run FIRST; warns + exits 1 on non-lexa repos (`LEXA_SWARM_ALLOW_NON_LEXA=1` bypasses) |
| `make-worktrees.sh` | `git worktree add` per lane + `status/swarm.json` (fork base SHA, lane records) |
| `brief-lane.sh` | extract a lane's `## Lane:` section from PLAN.md into `status/briefs/<lane>.md` |
| `lane-agents.sh` | scoped AGENTS.md per lane (allowed paths, brief/report contract, verify commands) |
| `spawn-layout.sh` | 7-pane herdr layout, opencode in lane panes, `dev:full` in dev pane |
| `wait-lane.sh` | block until a lane agent finishes (idle + new output), single call |
| `status.sh` | `report <lane> <state> [msg]` / `stale <minutes>` / `show <lane>` |
| `review-lane.sh` | build review package (manifest base..branch) into `status/reviews/<lane>.md` |
| `merge-gate.sh` | merge ledger-approved lanes contract-first, drift check, per-lane conflict isolation, gate |
| `gate.sh` | `tsc --noEmit` + `vitest run` + `bash wireframes/build.sh` |
| `prune.sh` | ancestry-checked `swarm/*` branch cleanup, dry-run default, `LEXA_SWARM_PRUNE=yes` to delete |

Env: `REPO` (main checkout), `FEATURE` (slug), `WT_BASE` (default `~/`), `STATUS_DIR` (default `<repo>/status`).

## State files (all gitignored under `<repo>/status/`)

- `PLAN.md` — feature plan, one `## Lane:` section per lane
- `swarm.json` — feature, fork `base` SHA, per-lane branch/worktree/brief/report/review/status paths
- `briefs/<lane>.md` — lane requirements (single source; never paste into prompts)
- `reports/<lane>.md` — lane's full report (chat reply is status only)
- `reviews/<lane>.md` — review package (commits, stat, diff base..branch)
- `ledger.md` — SDD ledger: `review clean` / `complete (N parked)` lines; **this gates merges**
- `<lane>.md` — status heartbeats (claims; the ledger is the record)

## Tests

```bash
bash ~/.agents/skills/lexa-swarm/tests/run-tests.sh
```

## Rules (summary)

- Wireframe-first; FE never parallel with WF
- BE owns `shared/types.ts` + `docs/API.md`; FE never writes them
- Lane agents touch only their scope (see lane AGENTS.md); report needs, never add endpoints
- No auto-commits; no scope creep; read lexa AGENTS.md invariants before coding
- Lane scope is enforced by REVIEW, not trust — out-of-scope files are Critical findings
- No merge without a ledger approval line for that lane
