---
name: lexa-swarm
description: 'Fullstack Lexa development orchestration via herdr panes — spawns one pane per track (wireframes, FE, BE, CLI, docs, dev-server) with one git worktree per lane, and encodes Lexa workflow rules so lane agents never violate them. Use when orchestrating multi-track Lexa development, running the herdr pane workflow, working with Lexa lane briefs/reports/ledger, or when asked to start or manage a Lexa swarm session.'
---

# Lexa Swarm — herdr pane orchestration for fullstack Lexa development

Spawns one herdr pane per track (wireframes, FE, BE, CLI, docs, dev-server) with one git worktree per lane, and encodes the Lexa workflow rules so lane agents never violate them. Orchestrator = opencode session in the main pane with this skill loaded.

The orchestration loop is SDD-style (subagent-driven development, adapted to panes): every lane works from a **brief file**, writes a **report file**, passes a **reviewer gate** with a fix loop, and is recorded in a **ledger** that survives compaction. Merge happens only for lanes the ledger approves.

## When to use

Working on Lexa (or any repo with the same lane shape) across multiple domains: FE (app/), BE (server/), CLI (cli/), docs, wireframes. Not for single-track fixes — use a normal session.

## Guardrail: lexa-shape check (MANDATORY before dispatch)

The lane scopes, wireframe-first gate, contract ownership, and per-lane AGENTS.md texts assume the lexa repo layout (`app/`, `server/`, `cli/`, `docs/`, `wireframes/` submodule, `shared/`, `migrations/`, `dev:full` script, AGENTS.md). On any other repo the lanes silently produce nonsense.

Run FIRST, before `make-worktrees.sh`:

```bash
bash ~/.agents/skills/lexa-swarm/scripts/check-project.sh "$REPO"
```

- Exit 0 → lexa-shaped, proceed.
- Exit nonzero → NOT lexa-shaped. STOP. Show the user the missing markers and ask explicitly: "This skill targets the lexa repo layout — continue anyway?" Do NOT proceed on your own. Only continue after (a) explicit user consent, or (b) `LEXA_SWARM_ALLOW_NON_LEXA=1` is set (non-interactive runs). With consent, expect lane scopes/gates to need manual adjustment — review `lane-agents.sh` scopes against the real repo.

## Phase state machine

`plan → wireframe-gate → lanes (per-lane brief → work → review → fix loop) → integrate (ledger-gated merge) → release`

1. **plan** — orchestrator decomposes feature into lanes, defines contract surface (API shape, `shared/types.ts` delta), writes `status/PLAN.md` with one `## Lane: <name>` section per lane. Non-UI features: WF lane skipped with explicit user sign-off in PLAN.md. Run `make-worktrees.sh` (writes `status/swarm.json`: fork base SHA + lane records).
2. **wireframe-gate** — WF lane edits `wireframes/src/`, runs `bash wireframes/build.sh`, reports DONE. FE lane WAITS. Orchestrator runs `git submodule update --init wireframes` before any FE work.
3. **lanes** — parallel. BE (contract owner), CLI, docs, FE (starts only after contract commit exists AND wireframe gate passed). Dev-server pane runs `bun run dev:full` throughout; lanes smoke-test via curl.
4. **integrate** — `merge-gate.sh` merges only ledger-approved lanes, in order (contract first), then runs gate.
5. **release** — orchestrator runs release checklist (both CHANGELOGs, version bumps, wireframes submodule pointer, annotated tags). Then `prune.sh` (env-gated).

## The per-lane SDD loop (orchestrator's job)

For each lane, in this exact order — never skip a step:

1. **Brief** — `bash brief-lane.sh $REPO <lane>` extracts the lane's section from `status/PLAN.md` into `status/briefs/<lane>.md`. A lane without a brief section is not dispatched. The brief is the lane's single source of requirements; dispatch prompts never paste task text.
2. **Dispatch** — `herdr agent prompt <lane> "<one-liner: read your brief at status/briefs/<lane>.md; interfaces from earlier lanes; report contract>"`. Exact values live only in the brief.
3. **Wait** — `bash wait-lane.sh <lane>` (blocking, single call). Never sleep-poll across turns. Then **verify artifacts** (gotcha 6): status file AND `git status --short` in the worktree — idle-with-no-changes = prompt never started.
4. **Report** — read `status/reports/<lane>.md` (the lane's full report; the chat reply was only status). Verify the lane ran its claimed gates.
5. **Review gate** — `bash review-lane.sh $REPO <lane>` builds the package (`base..branch`, base from manifest), then dispatch a reviewer subagent using `templates/lane-reviewer.md`. Reviewer checks: brief compliance, **lane scope violations (Critical)**, quality. Verdict: Approved | Needs fixes.
6. **Fix loop** — findings → `herdr agent prompt <lane> "<findings verbatim>"` + wait (rounds 1-3, same lane agent). Rounds 4-5: fresh lane agent on a more capable model, same brief + report file. After each round, re-run `review-lane.sh` + scoped re-review. Cap at 5: adjudicate — park minors with rulings, BLOCKED on load-bearing.
7. **Ledger** — every state change appends to `status/ledger.md` (survives compaction; it is the merge gate's input):
   - `Lane <lane>: dispatched (<brief> -> <report>)`
   - `Lane <lane>: review <round>/5 (<addressed> addressed, <open> open)`
   - `Lane <lane>: parked — <finding> — ruling: <why>`
   - `Lane <lane>: review clean (commits <base7>..<head7>)`
   - `Lane <lane>: complete (<n> parked)` — only after breaker adjudication
   - `Lane <lane>: BLOCKED — <reason>` — stop, report to user
   - `Lane <lane>: merged`

Never fix lane findings in the orchestrator session; never accept a lane's DONE without a review; never merge a lane the ledger does not approve.

## Rules (non-negotiable, from lexa AGENTS.md)

- **Wireframe-first**: WF lane completes before FE lane starts. Never WF+FE in parallel.
- **BE owns the contract**: only the BE lane writes `shared/types.ts` and `docs/API.md`. FE never writes them.
- **Agent file boundaries**: FE lane may only touch `app/`, `wireframes/DESIGN_SYSTEM.md`, `wireframes/src/design-system.css`. BE lane only `server/`, `migrations/`, `shared/` contract files. CLI lane only `cli/`. Docs lane only `docs/`. Nobody touches `package.json`, `tsconfig.json`, `app.config.ts` without orchestrator approval. Enforcement is by REVIEW, not trust — scope violations are Critical findings.
- **No scope creep**: nothing outside design docs; names exact (tables, columns, error codes, routes, tools).
- **Architectural invariants**: see lexa AGENTS.md (service cycles, echo suppression, positions, WIP limits, emission invariant, MCP↔REST boundaries, etc.). Lane agents must re-read lexa AGENTS.md.
- **No auto-commits**: lane agents commit only when the orchestrator/user asks. Gate passes first.
- **No comments** in code unless behavior is genuinely non-obvious. TypeScript strict.

## Lane manifest & files

- `scripts/lanes.conf` — lane, worktree name, repo-relative path. Single source of truth.
- `status/swarm.json` — feature, fork `base` SHA, per-lane: branch, worktree, brief/report/review/status paths. Written by `make-worktrees.sh`; read by `review-lane.sh`, `merge-gate.sh`.
- Branch: `swarm/<feature>/<lane>`. Worktree: `$WT_BASE/<worktree-name>` (default `~/`).

## Status protocol

- Lane status lives at `<main-checkout>/status/<lane>.md` (gitignored).
- Format: `state: <PLAN|WAIT|WORKING|DONE|FAILED>` + `ts: <epoch>` + `msg: <message>`.
- Every action appends a heartbeat (update ts). `DONE` requires `tsc --noEmit` green + lane tests + report file written. DONE never means reviewed.
- Orchestrator: `status.sh stale 10` lists dead lanes (ts older than 10 min). Stale = not done; re-spawn lane (worktree + branch survive).
- The status file is a CLAIM. The ledger is the RECORD that gates merges.

## Orchestrator responsibilities

1. Run `check-project.sh $REPO` FIRST (guardrail — warn + ask on non-lexa). Then `make-worktrees.sh` (REPO + FEATURE env) and `lane-agents.sh` before spawning.
2. Dispatch lanes per state machine; enforce gates; run the per-lane SDD loop (brief → dispatch → wait → report → review → fix loop → ledger).
3. **Wait, don't poll:** after sending a lane prompt, run
   `bash ~/.agents/skills/lexa-swarm/scripts/wait-lane.sh <lane>` (blocking,
   single call). It polls agent state + status file + worktree changes and
   exits when the lane is idle with new output. Do NOT use `herdr agent wait`
   — it matches the state at call time and misses working→idle transitions
   (hangs forever). Never sleep-poll across separate turns; that is how
   continuations break. Always verify artifacts afterwards (gotcha 6) —
   idle-with-no-worktree-changes = the prompt never started.
4. Review each lane (`review-lane.sh` + reviewer subagent) before merge — never skip.
5. `merge-gate.sh` — merges ONLY ledger-approved lanes, order `be → wf → fe → cli → docs` (contract first), per-lane conflict isolation, then `gate.sh`.
6. Gate failure: fix trivial fallout yourself; deep breakage re-dispatches owning lane with error excerpt.
7. Release checklist: both CHANGELOGs updated, versions bumped (web `package.json` + tag `vX.Y.Z`, CLI `cli/package.json` + tag `cli-vX.Y.Z`), wireframes submodule committed+pushed first, `gate.sh` green, annotated tags.
8. After release: `prune.sh` (dry-run; `LEXA_SWARM_PRUNE=yes` to delete merged `swarm/*` branches).

## Quickstart

```bash
export REPO=~/projects/lexa FEATURE=<feature-slug>
bash ~/.agents/skills/lexa-swarm/scripts/make-worktrees.sh   # one worktree per lane + status/swarm.json
bash ~/.agents/skills/lexa-swarm/scripts/lane-agents.sh      # per-lane AGENTS.md
# in the herdr session:
bash ~/.agents/skills/lexa-swarm/scripts/spawn-layout.sh     # 7 panes, opencode in lane panes
```

Orchestrator stays in the main pane (this session). Lane panes run their own opencode sessions with scoped AGENTS.md.

## Verification

`gate.sh`: `tsc --noEmit` + `vitest run` + `bash wireframes/build.sh`. Tests: `bash ~/.agents/skills/lexa-swarm/tests/run-tests.sh`.

## Operations & gotchas (each one cost a session — read before orchestrating)

1. **Max 4 panes per tab** (user rule). `spawn-layout.sh` creates three tabs:
   "lanes" (wf/be/cli/docs, equal 2x2), "lanes-fe" (fe, gate-waiter), "dev"
   (dev-server). Do NOT stack all lanes into one tab.
2. **herdr `--ratio` takes 0..1.** `--ratio 50` silently produces broken
   0.4/0.9 splits. Always pass `0.5` and verify `herdr pane layout` rects
   after each split (unequal = fix before launching).
3. **Lane cwd goes stale when the dir is removed/recreated** (worktree
   moves): pane list shows "(deleted)", `opencode` fails with "current
   working directory was deleted". Fix: `cd <worktree> && opencode` (the
   script does this). Kill a running lane TUI with `send-keys ctrl+c`, wait
   for the shell prompt, then relaunch — `pane run` over a live TUI does
   nothing.
4. **Worktree tooling fails silently** — never pipe a swarm script through
   `| tail` without checking its exit code: (a) `git worktree remove` accepts
   ONE path per invocation (multi-path = silent no-op); (b) `make-worktrees.sh`
   dies when a `swarm/<feature>/<lane>` branch still exists (worktree removal
   does not delete branches — `git branch -D` them first, or `prune.sh`);
   (c) always confirm with `git worktree list` before wiring panes.
5. **`git worktree add` does not init submodules.** The wf lane's
   `wireframes/` must be initialized explicitly
   (`git -C <wf-wt> submodule update --init wireframes`) — without it the
   lane edits nothing and claims DONE anyway.
6. **Never trust a lane's DONE status file alone.** A lane working in an
   empty/misplaced dir will fabricate progress (observed: wf wrote `state:
   DONE` with zero artifacts on disk). Verify: artifacts exist in the
   worktree (`git status --short` per lane) + the claimed gates actually ran.
   The review gate is the second net — scope violations are Critical.
7. **Orchestrator loop:** poll `status/<lane>.md` AND the lane worktrees'
   `git status` together; a status without worktree changes is a lie.
8. **zsh does not word-split unquoted variables** (`for x in "a b"; set -- $x`
   keeps `$1 = "a b"`). Use explicit args in scripts; herd-lane commands via
   `send-text <pane> <prompt>` + `send-keys <pane> Enter`.
9. **Name the lanes like Codex:** `herdr integration install opencode` (writes
   `~/.config/opencode/plugins/herdr-agent-state.js`, global config — reload
   needs an opencode restart), then launch via
   `herdr agent start <lane> --kind opencode --pane <id>` — `herdr agent list`
   then shows `wf/be/cli/docs/fe` instead of anonymous "opencode" processes.
   `spawn-layout.sh` does this automatically. Restarting a lane =
   `send-keys ctrl+c` (wait for the shell prompt; a live TUI blocks `agent
   start` with `agent_pane_busy`), then `agent start` again.
10. **Continuation:** lane agents finish their turns silently — nothing
    notifies the orchestrator's session. Always pair dispatch with
    `herdr agent wait <lane> --until idle` (orchestrator responsibility 3)
    so the orchestrator resumes automatically. `herdr agent wait` states:
    idle/working/blocked/done.
11. **Ledger is the merge gate.** A lane with a green status file but no
    `review clean` ledger line is NOT merged. If the ledger is lost
    (deleted status dir), re-review from the manifest base — never merge on
    trust.
