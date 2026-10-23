---
name: orchestration
description: 'Agent-lane orchestration plane — dispatch a frozen plan into isolated native subagent lanes and read-only native subagents, run the execution gate, verify, close out per lane, review, merge, and loop until the plan is done. One harness instance/coordinator owns one plan. Loaded by `/goal` after its planning phases, and directly by `/orchestrate`. Owns the main-session guard, simple/complex routing, the execution gate, isolate/dispatch/return, verify/loop, break points, and guardrails.'
metadata:
  requires:
    - work-plans
---

# Orchestration

Execute a frozen plan through dependency-safe native lanes, verification,
review and approved close-out. `work-plans` owns tracking; optional `/goal`
owns intake and multi-plan scheduling. `/orchestrate` runs inline for one plan
or as one separate H2H coordinator; it never becomes the command center.

**One coordinator, one plan.** A coordinator is one harness instance and owns
exactly one plan: `$PLAN_DIR`, its lanes, worktrees, workers, and records. A
second plan — including one requested mid-loop — is NEVER absorbed into this
coordinator; it needs its own user-authorized harness instance/coordinator,
with no cross-plan writers or shared implementation ownership. One coordinator
never writes another plan's folder and never rewrites the shared TIMELINE.

H2H: acknowledge the exact plan/revision/attempt before execution; obey its gate.
Write semantic progress and findings only in your plan; never mutate center state
or take another plan. Escalate cross-plan conflicts and approval changes.
Turn end/cancel is not child quiescence. Same-plan findings restart planning, preserving progress.

Autonomy: full-auto AFTER the execution gate. Human gates exist only
before execution (goal clarity, design direction, protocol + role/model
approval); once execution starts the loop never waits for a human — wave
reports are read async, the rails below replace further gates. Approving
the gate pre-authorizes exactly the lifecycle it enumerates (branch →
commit → push → PR → review ∥ CI → auto-merge when both are green) for the named lanes/branches.

## Native runtime (discovered, never invented)

Lanes are the CURRENT harness's built-in native subagents, not new harness
instances. At loop start, discover and record (see
`references/native-dispatch.md` § Discover first): the native dispatch form
and accepted roles, how a handle is awaited, how an incomplete worker is
resumed, the concurrency cap, and the harness-supported role/model option.

Rules:
- Use only discovered forms. Never require a vendor/version, pin CLI syntax,
  run another harness or model CLI, create a pane/session/terminal per lane,
  or check a TTY/environment marker.
- Native parallel dispatch/join/resume unavailable → WAIT + report the
  capability gap; never fall back to process spawning. Dispatch without join
  runs lanes serially.
- A lane shares the coordinator's harness instance but NEVER its
  implementation file ownership: scoped worktree path/cwd + explicit branch.
- A second harness instance is only for a different plan, authorized by the
  user — never per lane and never as a fallback.
- Read-only children do not write reports; the coordinator persists every
  child result.

## Requires

- `work-plans` — tracking-plane rules; orchestration owns in-loop updates + close-out, `goal` owns the open.

## The orchestration graph (this skill IS the pipeline for it)

```
              ┌──────── findings → plan/replan (re-approve scope) ──────┐
              ▲                          ▲                             │
              │ red check                │ red review / CI             │
              │                          │                             │
GATE → isolate → WAVE W1 ─┬─ DB lane      (schema + migration)         │
                          ├─ backend lane (API + service)              │
                          └─ UI lane      (view + interaction)         │
                                    │                                  │
                                    ▼                                  │
                        per-lane checks ─green─► review ∥ CI per lane   │
                                                    │ green            │
                                                    ▼                  │
                                                 merge PR ─► next wave │
                                    frozen acceptance met → DONE        │
                                    frozen acceptance unmet ────────────┘
```

Lanes are illustrative; default `work-plans` execution walks the same nodes
sequentially in one worktree. Lifecycle, E/R, boundary, full loop:
`references/loop-graph.md`.

## Main-session guard (orchestrator never codes)

Applies only inside an orchestration loop. The main session is the
orchestrator, not an implementer. It NEVER edits implementation code or
design docs — whatever paths the project declares in its `AGENTS.md` — nor
any skill/config file, and never calls a mutating tool against them.

The orchestrator writes only the tracking plane directly: `$PLAN_DIR/`
(`plan.md`, `status.md`, `lanes/<lane>.md`, `report.md`) and `mem_save`;
resolve the root once with `scripts/plan-root.sh`. The shared
`$PLAN_ROOT/TIMELINE.md` is append-only and is written ONLY through
`scripts/plan-event.sh` (never rewritten); a coordinator writes only its own
plan folder. Tracking is external to the repository and every worktree. The
orchestrator also validates lane results, runs gates, and drives close-out
(PR), review, CI, and merge — it does not produce the diff.

Delegation by node type (matches the graph):
- **Application-behavior mutation nodes → native lane worker(s).** Lane roles:
  `swe` (implementation), `designer` (design artifacts). Simple = exactly
  one lane. Complex = one lane per track (1..N). Each lane is one native
  worker subagent inside the coordinator's harness (visible in its UI when
  supported), assigned one worktree + branch. It returns a structured result;
  the coordinator persists it, and the lane is not green until that result
  carries evidence.
- **Non-behavior upkeep mutation nodes → `steward`.** Worktree/branch chores
  (release prep) run as a **steward LANE** — same native worker vehicle, its
  own worktree. In-place upkeep (docs sync, hygiene, dep bumps) runs as the
  **`steward` native subagent**: ONE at a time (never alongside another
  mutating subagent), named files, never commits/pushes/tags, hardened gate
  (shared control checkout — Phase 5). Behavior change mid-node → WAIT +
  re-dispatch to a `swe`/`designer` lane.
- **Read-only nodes → native read-only subagents.** `architect` = single
  foreground (inline, blocking) call. `researcher` = foreground by default,
  but MUST fan out when a wave needs ≥2 independent lookups (read-only →
  collision-free; `researcher` may itself fan out leaf `explore` children).
  `reviewer` = one per lane, dispatched async over the open PRs across the
  review wave; findings to its own lane, green gates its merge. All three
  never mutate and write no report — the coordinator persists their findings.
  Role/model come from harness-supported configuration, never a CLI pin.

A mutation the orchestrator makes itself is a violation: stop, revert it
before proceeding, and re-dispatch the work to the correct plane (behavior
→ lane; non-behavior upkeep → `steward`: worktree chore → lane, in-place →
subagent). Design artifacts that must land as files: the project's design
artifacts → `designer` lane;
decision records / specs → merged into the project's design authority
docs; implementation-plan content → folded into `$PLAN_DIR/plan.md`,
never a separate plans tree. A mutation lane (`swe`) persists the
architect artifact verbatim — the read-only `architect` never writes.

## Routing: simple vs complex (lane count — risk + scope)

Classify before designing. When unsure, it is complex. This picks how many
mutation lanes and how deep the review runs.

**Simple** — ALL must hold:
- one concern, one track
- touches no named contract surface (the project's schema/API/layer
  invariant docs and migrations)
- no change to the project's design authority (design artifacts,
  design-system primitives)
- no shared-file collision (migrations, CHANGELOG, submodule gitlinks,
  lockfiles)
- no second parallelizable track

**Complex** — ANY one makes it complex:
- touches a schema/API/architecture invariant, a service/repo/error
  contract, or a migration
- touches the project's design authority
- multi-concern or broad refactor (one concern per lane)
- ≥2 independent tracks (even small ones)
- shared-file collision, or risk too broad for one brief

Route: **simple** → exactly one mutation lane in the single plan worktree.
**complex** → one mutation lane per track (1..N; single track = one lane).
File count is a hint, never a gate — classify on contract surface.

## Execution gate (LAST human gate — nothing human after this)

Present for one-shot approval: frozen acceptance, the wave graph
(waves + lanes + one owner per node), chosen route + why, mutation lanes
+ role agents + resolved role/model from harness-supported configuration
(or a gate-approved `plan.md` choice — never a fixed CLI pin; the question
tool has no defaults), read-only roles used, worktree path(s) + branch
name(s), concurrency plan (native cap + queued excess), autonomy envelope
(worktree → branch → commit → push → PR → review ∥ CI → auto-merge on green
CI + green review). User approves → Phase 4 isolates first, then runs with
zero further questions. User rejects/changes → return to intake/design and
plan/approval, then re-present. No approval = no execution. Approval lapses after 72h or
if the goal text changed → re-present only the diff, not the whole gate.
New worktrees use the gate-approved base (normally latest `main`).
Prepared worktrees retain their approved base and permitted prior changes;
main movement never authorizes an unapproved reset or rebase.

Simple-route gate may be concise, but still names scope/acceptance, exact
worktree/branch, native role/model and each authorized lifecycle action.
An acknowledgment approves only those listed actions; omitted commit, push,
PR, merge or cleanup remains unauthorized.

## Jev judgment layer (advisory)

When `jev-mcp` is reachable: a cheap typed pre-filter at the gate, batch
dispatch/return, review wave, and pre-merge — ADVISORY only, never replacing
the human gate, the `reviewer`, CI, or the evidence rule. Contract:
`references/jev-layer.md`.

## Phase 4 — Execute (zero questions from here)

### 4.1 Isolate FIRST (mandatory, every route)

1. For new mutation worktrees, fetch the approved base and check ignored
   `.worktrees/`, branch/path collisions and named creation permission.
   Prepared worktrees use the ownership checks below instead of collision
   rejection. Control-checkout dirt is expected; never branch from it.
   Read-only assignments skip creation, fetch and mutation setup.
2. Isolate using `references/lane-dispatch.md`: simple uses one plan worktree;
   complex uses one per lane. An H2H-prepared simple worktree is reused ONLY
   after checking exact canonical path, branch, repository, approved base,
   current plan/attempt ownership and absence of another live/unknown writer.
   Retain that approved identity; never suffix it or create a replacement.
   Unknown dirt/ownership → WAIT. Unprepared paths require named creation
   approval and collision guards; never reuse an unrelated existing tree.
   Create all authorized lane worktrees before concurrent setup. Run declared
   setup/baseline in their exact paths; copy secrets only if authorized,
   never commit them. Read-only work does not create mutation lanes.
   Tracking lives under `$PLAN_ROOT` (resolved by `plan-root.sh`), outside
   the control checkout and every worktree; code work never writes there and
   no in-repo status directory is created.
3. `git worktree add` failing (branch/path collision) → FAST EXIT naming
   the cause — never proceed unisolated in the control checkout.
4. Clean check INSIDE the fresh worktree: `git status --porcelain` —
   clean expected there; dirty from an unknown source → WAIT + report,
   never build on top of it.

### 4.2 Dispatch — the brief IS the delegated subgraph

Follow `references/lane-dispatch.md` for the order (guards → worktrees →
concurrent setup → batch-dispatch → join → persist → close-out). Role names
by DISCOVERY, never hardcoded: `swe` (implement/fix), `designer`
(design artifacts), `steward` (worktree/branch upkeep — release prep;
behavior change → WAIT + re-dispatch). A lane role travels in the brief. If
no fitting native role exists, keep the lane WAIT and report the gap; never
invent a role or start another harness.

A lane whose plan declares `## Tasks` runs crumb sub-waves per
`references/crumb-execution.md` (ready disjoint set → bounded native crumb
workers → `lane-verify` per join → next set); no `## Tasks` → the path below.

Dispatch (protocol detail: `references/native-dispatch.md`):
- Resolve role + model ONLY through harness-supported agent configuration or
  options, or the gate-approved choice in `plan.md` (R). Record resolved
  role+model in `plan.md`'s lane-attempt section; a worker may not silently choose another
  model. Unavailable/erroring approved role or model → FAST EXIT naming the
  gap; never substitute.
- Batch: issue every independent ready lane before awaiting any handle.
  Honor the harness concurrency cap and queue the excess. No nested
  coordinator/harness per lane, no unbounded recursive subagents.
- One lane, one worktree, one branch, one native worker, disjoint file set.
  Each dispatch targets the absolute worktree as cwd and the branch as
  boundary.
- No shell runner, pane, TTY check, or external session CLI.

Brief (subgraph IN — every lane, self-contained):
```
WHY:            <reason this node exists>
Nodes:          <exact files/units, one owner, path:line>
Edges:          <inputs consumed from prior waves; outputs for dependents>
Governing docs: <repo bindings / design docs that win>
Acceptance:     <frozen criteria from plan.md>
Gate:           <verification command(s)>
Forbidden:      act outside the worktree; exfiltrate beyond declared
                fetches; --force or history rewrite on shared branches;
                commit secrets; dispatch a nested coordinator
Boundary:       cwd <absolute worktree>; branch <branch>; no commit, no push;
                never write the external tracking plane or shared TIMELINE
Result:         <plan, lane, attempt, role/model identity + Implemented /
                Evidence / Deviations / Blockers — persisted by the coordinator>
```

Join: await the discovered native completion surface. Never infer completion
from elapsed time or artifact polling. A timeout or missing completion is not
success; re-await, then resume the SAME lane/attempt in the same worktree,
preserving checked work, the existing PR, and the loop counters. Re-dispatch
only for the same plan/lane/worktree.

### 4.3 Return — the result IS the implemented graph

Native completion is runtime completion; the artifacts the coordinator
persists are the recovery truth. On completion the coordinator:
1. checks the result's identity (plan + lane + attempt) and evidence;
2. compares the implemented graph against the delegated subgraph — extra or
   missing node = deviation, never silently accepted;
3. keeps `$PLAN_DIR/lanes/<lane>.md` a three-line heartbeat; persists structured
   identity, result, evidence, and findings in `plan.md`, linked by its `msg`;
   appends the lane event via `plan-event.sh`.
A lane that returns no evidence (bare "done", missing gate output) is NOT
green. Failed or missing native completion → resume/re-dispatch the same
lane; unrecoverable → WAIT + report.

Reply style: caveman-compressed EXCEPT `reviewer`, which runs full prose
(compression drops review nuance). Return fields:
```
Implemented: <files changed + what changed>
Evidence:    <gate output tails + full log path>
Deviations:  <extra/missing/renamed nodes vs the delegated subgraph>
Open:        <blockers, if any>
```

Lane rules: a lane that hits a contract mismatch or needs out-of-scope
files flips to WAIT and reports — never guesses. Lanes may run their own
scoped read-only helpers while files/scopes don't collide; they never
dispatch a nested coordinator or write tracking. The orchestrator's
read-only calls (`architect`/`researcher`/`reviewer`) MUST NOT touch anything
already delegated; the one mutating subagent (`steward`, non-behavior upkeep)
is serialized and gate-checked ("Hardened gate for mutating subagents", Phase
5); the orchestrator never edits files itself.

Lane lifecycle: the native worker completes → the coordinator persists the
result and records it → worktree + branch stay until the PR merges (never
delete early; the reviewer still reads it); pre-merge removal needs explicit
user approval. Resume an incomplete lane in the SAME worktree/session with
its persisted state (re-brief from `plan.md`'s lane-attempt section and heartbeat). Each lane runs
`git status` FIRST inside its own worktree — clean expected there; dirty from
an unknown source → WAIT + report, never build on top of it (control-checkout
dirt is irrelevant — lanes never touch it).

## Phase 5 — Verify + loop (guarded)

Gate per route (lane runs its own row; coordinator re-runs it at
integration — trust lane output, but verify before commit). Use the
project's gate commands as declared in its `AGENTS.md` / package scripts:
- design artifacts: the project's design build must exit 0, plus a
  content check on the emitted output.
- code: typecheck + the test suites for the touched areas + any project
  invariant check.
- docs-only: reviewer read (names/numbers match source files verbatim).
If the project declares no gates, run its closest build/test command and
declare the gap.

### Hardened gate for mutating subagents

A mutating subagent (`steward`, non-behavior upkeep) edits the shared
control checkout — no worktree isolation — so the gate compensates:
1. **Serialize.** One mutating subagent at a time; never in parallel with
   another mutating subagent or with a lane touching the same files.
2. **Scope.** The node owns named files. The subagent MUST NOT touch
   `$PLAN_DIR/**` (orchestrator-only, external tracking plane), a lane's
   files, or anything already delegated.
3. **No commit.** Leave changes uncommitted; no push, tag, or history
   rewrite; secrets/`.env` refused.
4. **Verify then accept.** On return the orchestrator runs the frozen gate
   commands, reads `git diff`, and compares it to the delegated subgraph.
   Out-of-scope hunk or gate-fail → revert the affected paths, then WAIT +
   re-dispatch. A bare "done" without gate output is never green.

Compare (the payoff of the subgraph boundary): implemented graph vs
delegated subgraph for every lane. Extra node = off-script (revert or
justify); missing node = skipped work (lane fixes or report). A
mismatch is a deviation, never silently accepted.

Evidence rule: paste gate output tails into the lane report — a bare
"tests pass" without output does not count as green. Attach the full
gate log path when the project's gate script emits one.
Pre-existing failures: lane suite red → rerun the SAME suite on a
pristine `main` checkout → identical failure = pre-existing: declare it
in the PR body and proceed; new failure = lane fixes it first. Scoped
reruns and the pristine-main recipe live in the project's git/gate docs
if declared.
Missing tool: `command -v` first, then the closest equivalent, and
declare the deviation.

End of every wave: gates + FROZEN acceptance + graph compare per lane. A
lane green + met → close out immediately (commit/push/PR) and start its
reviewer over the open PR (async); a lane red or unmet → adjust the plan,
record the deviation, next loop iteration.

Review wave (async, per lane, over the OPEN PR): every lane gets a
reviewer pass (correctness, scope, edge cases) on its PR diff — jev
review pre-filter at return, before close-out (§ Jev judgment layer). Dispatch
one native `reviewer` per lane at once — read-only, collision-free; review
and CI run concurrently. Bind each reviewer to its own lane (stable
reviewer↔lane map); findings return to that lane only, never around it — the
fix resumes the same lane (same worktree/session), pushes to the same
branch, and the reviewer re-reviews it; CI re-runs. A reviewer that fails or
times out is NOT green — retry it; none discoverable → orchestrator
self-reviews against a checklist (scope match, acceptance re-checked, edge
cases, staged names secret-free), records it as the fallback verdict, and the
PR merges only on a green verdict. Lane findings and review evidence live in
`plan.md`'s lane-attempt section; the three-line heartbeat points there.
Append a plan event; `report.md`/DONE remain coordinator-owned, aggregating lanes.

**Findings and replan.** Any failed lane check, reviewer verdict, or CI run
returns to planning as a finding in the same `$PLAN_DIR/plan.md` (ID, source,
evidence, affected lanes/files, fix steps, dependencies, verification, and
resolution evidence). Preserve completed steps, merged lanes, their worktrees
and open PRs, and the frozen acceptance; re-run the plan graph and affected
checks before resumed work. Replanning never resets the iteration/no-progress
counters. A finding that changes scope, contracts, or authorization needs
explicit re-approval before work resumes; it never reauthorizes arbitrary git
(`git-workflow` still governs). Per-lane review and CI stay independent and
barrier only at required dependency joins. If the final frozen acceptance is
still unmet, replan; never report DONE because the listed waves ran out.

Auto close-out (per lane): the coordinator closes out a green + met lane:
commit on its branch (conventional message, body = WHY), push (`git push -u
origin <branch>`), and open a PR (base `main`, body = result + gate tails +
deviations) — no reviewer before the PR exists. Lanes are edge-independent:
each closes out as it turns green, no sibling wait. Invoking `/goal` (or
`/orchestrate`) plus the approved gate is the explicit ask for the enumerated
lifecycle. Then the merge gate: a PR merges when CI is green AND its reviewer
pass is green; reviewer findings route back to the lane (fix → push → CI
re-runs). CI red → fix loop (counts toward the loop guard); unfixable → leave
open + report. Merge BLOCKED BY POLICY (e.g. required-human-review, not red
CI) → leave open + report immediately, never poll. Worktree/branch removal
requires named cleanup approval and no live/unknown writer. Preserve the
coordinator's active cwd until verified shutdown. Tracking stays external;
implementation/evidence summaries, not tracking paths, travel in PRs.

Plan close-out (plan reached DONE/FAILED): once every lane in the plan is
closed out (PRs merged, or terminally parked/reported), or the plan closes
FAILED at the hard cap, the coordinator performs authorized cleanup only —
(1) remove merged lane trees/branches only with no live/unknown writer;
retain its active coordinator cwd; (2) finalize the tracking plane — the
single owner: write `$PLAN_DIR/report.md`, then run
`bash ~/.agents/skills/work-plans/scripts/plan-check.sh -- <plan>` and, when
`jev-mcp` is reachable, the work-plans closure judgment (`work-plans`
§ Jev judgment) against that report; then flip `$PLAN_DIR/status.md`
(`state: DONE` or `FAILED`), record the closure event through
`plan-event.sh <plan> <DONE|FAILED> "<one line>" <plan>/report.md`, and
`mem_save` (resolved artifact paths, not copies of the content). The plan is
not DONE until required acceptance and tracking are finalized. Record retained
worktrees, deferred cleanup and cleanup failures explicitly; never erase them.
Append the plan event with `runlog.sh plan plan=<plan> verdict=<DONE|FAILED>
wall_s=<n> lanes=<n> prs=<n> iter=<n>`; view runs with `scripts/run-report.sh`.
Report progress per wave as state, commit sha, one-line test summary, concerns.

## Break points (E — coordinator failures, handled outside the happy path)

- **FAST EXIT** (that lane only; name the cause, never fall back
  silently): `git worktree add` branch/path collision; approved role or model
  unavailable/erroring at dispatch (never substitute another model —
  cost/behavior was approved as-is); no resolvable role/model for a lane.
- **WAIT** (park the lane, continue others, report the blocker): native
  dispatch/join/resume capability missing (never spawn a process instead);
  contract mismatch; needs out-of-scope files; no fitting native role;
  clean-check failure inside the worktree from an unknown source.
- **Second plan mid-loop**: the coordinator cannot absorb it. Pause that
  request, report, and require a separate user-authorized harness
  instance/coordinator; never create cross-plan writers or ownership.
- **Steward lane scope bleed**: a `steward` lane meets an application-
  behavior change → WAIT + report and re-dispatch that node to a
  `swe`/`designer` lane; steward never absorbs behavior changes (its remit
  is non-behavior upkeep only).
- **Native worker dead before completion persisted**: missing completion
  handle/result or missing evidence → resume the SAME lane/attempt in the
  same worktree; unrecoverable → WAIT + report. Never infer completion from
  elapsed time, and never spawn a second harness to check it.
- **Lane result failed**: the result reports failure (rc≠0 equivalent) —
  it is not a green signal; treat per the error (FAST EXIT/WAIT), never
  proceed to close-out.
- **Reviewer fan-out**: a reviewer that times out or fails is not green —
  retry it or self-review that lane; its PR stays open, merge blocked. The
  reviewer↔lane map stays stable, a review never crosses to a sibling lane.
- **Jev unavailable/abstain**: the advisory judgment layer is skipped and
  the loop falls back to the existing reviewer path — never a blocker,
  never a completion signal.
- **Loop guard**: max 3 iterations on the same wave without progress —
  progress means ≥1 newly-green acceptance item or gate since the last
  iteration. No progress → park that lane WAIT, continue others, note the
  blocker. Hard cap 5 wave iterations per plan → close as FAILED with
  blockers listed (`report.md` records what shipped), never spin forever.
  Same point failing twice → change strategy first. Findings appended in a
  replan never reset these counters; resumed work inherits them.
- **Secrets/credentials exposure**: the only halt-everything — stop that
  lane immediately and report.
- **Merge-blocked-by-policy**: leave open + report, never poll.

## Edge cases

Non-optional traps — dirty worktree, shared-file collisions,
rebase-before-PR, files-are-truth (incl. post-compaction recovery), one
coordinator per plan, and plan-env hygiene: `references/edge-cases.md`. Read
it before closing a wave.

## Standing guardrails (every loop)

- Main-session guard: see § Main-session guard — writes only `$PLAN_DIR/**`,
  the shared TIMELINE via `plan-event.sh`, and memory; never implementation
  code, design docs, or an in-repo status tree.
- Native dispatch only: every lane is a native subagent of THIS harness
  instance in its own worktree. Never a second harness/process/pane per lane,
  never a shell runner or TTY marker. One coordinator owns one plan.
- Repo bindings, before touching code: load the project's declared design
  authority in the order its `AGENTS.md` gives (typically schema → layers
  → API → design artifacts → architecture rationale). Names and
  invariants verbatim. Docs conflict → STOP + report, never resolve alone.
- Destructive or irreversible steps (migrations, deletes, deploys,
  force-push, history rewrites) are auto-approved INSIDE lane
  branches/worktrees only — blast radius ends at the PR. Hard forbidden,
  no exceptions: mutating `main` outside PR flow, force-pushing shared
  branches, touching prod data, committing secrets (staged-name check runs
  before every commit; a hit stops the lane and is reported).
- Git guardrails before any git mutation (single trunk — the
  `git-workflow` skill). Branch → PR → merge, never commit on `main`.
  Invoking `/goal` or `/orchestrate` covers close-out only for the
  lifecycle enumerated at the execution gate and approved there. After
  isolate, every code mutation (edit, gate, commit) runs inside the
  assigned worktree — never in the control checkout. The coordinator
  performs lane commit/push/PR/merge; workers never do. Stage files
  explicitly, check staged names for secrets.
- Design-artifact-first for UI: the project's design authority + its build
  before implementation.
- Conventional commits (`feat|fix(scope): subject`, body = WHY).
- Submodule rule: if the project uses submodules, commit+push inside the
  submodule first, then bump the pointer in the parent.
