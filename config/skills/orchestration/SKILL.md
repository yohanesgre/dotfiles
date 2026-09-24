---
name: orchestration
description: 'Agent-lane orchestration plane — dispatch planned work into isolated luvus lanes and read-only subagents, run the execution gate, verify, review, close out per lane, merge, and loop until the plan is done. Loaded by `/goal` after its planning phases, and directly by `/orchestrate`. Owns the main-session guard, simple/complex routing, the execution gate, isolate/dispatch/return, verify/loop, break points, and guardrails.'
metadata:
  requires:
    - work-plans
---

# Orchestration

Run a frozen plan to DONE by dispatching it into isolated lanes. This is
the execution plane: isolate → dispatch → verify → review → close out →
merge → loop. It does not plan or track — `goal` (with `work-plans`) owns
intake, design, protocol, and the tracking plane; orchestration consumes
that plan and produces a verified, merged implementation.

Invoked two ways: `/goal` hands off here after its Phase 3 (planning +
tracking), or `/orchestrate` loads it directly when a plan/wave graph
already exists.

Autonomy: full-auto AFTER the execution gate. Human gates exist only
before execution (goal clarity, design direction, protocol + model/effort
approval). Once execution starts, the loop never waits for a human. Safety
after the gate comes from the automated rails below. The user reads wave
reports async; the loop never blocks on them. Approving the execution gate
pre-authorizes exactly the lifecycle it enumerates (branch → commit → push
→ PR → auto-merge on green CI) for exactly the named lanes/branches. The
gate approves scope and waves.

Runtime: opencode (v2) only. Assumed surfaces: luvus CLI and opencode
flags — exact pinned signatures live in `references/cli-reference.md` and
are the ONLY forms to use. Never probe `--help` for syntax (a wasted,
nondeterministic step); `luvus help all` is the single sanctioned discovery
command and is not part of the lane loop.
Surfaces: luvus `pane split/run/read/close`, `tab new/focus/close`,
`workspace list/focus`, `wait output`, `agent start/prompt/wait/read`
(native kinds only — lanes use `pane run`), plus UHP
`layout.apply`/`session.snapshot` through `luvus uhp proxy`; opencode
`run --auto --model --agent [--session]` (prompt is positional, no
`--prompt`), plus V2 command frontmatter
(`description/agent/model/subagent`), project skill dir `.agents/skills/`,
project commands dir `.opencode/commands/`. MCP tools arrive through
`execute` (Code Mode): `tools["jev-mcp"].*` (optional advisory judgments,
§ Jev judgment layer) and `tools["icm"].*` (memory). If this session is
not opencode, STOP and flag before doing anything.

## Requires

- `work-plans` — tracking-plane rules; orchestration owns in-loop updates + close-out, `goal` owns the open.

## The orchestration graph (this skill IS the pipeline for it)

```
A — happy path (execution graph)
GATE → isolate → wave{lanes} → verify → review-wave{reviewer_i ∥}
     → per-lane close(PR) → merge → loop: next wave | DONE

Lane node lifecycle (visible pane, persists through the loop)
spawn → work live in pane → persist return to <slug>-return.md
     → pane persists through loop → plan DONE/FAILED: close all lane panes

E — break points (coordinator failures, not worker failures)
wrong context · missing input (invisible edge) · misinterpretation
luvus/env/binary/model/agent gap · secrets · no progress
lane dead before return persisted · reviewer fail/timeout ·
reviewer ↔ lane drift · jev unavailable/abstain

R — every worker prompt carries
subgraph (nodes+edges) · WHY · governing docs · acceptance · gate · forbidden

Boundary: prompt = delegated subgraph IN → return = implemented graph OUT
(on disk: `<slug>-return.md` is the sentinel; the pane persists through
the loop). Verify:
compare implemented graph vs delegated subgraph; extra/missing node =
deviation.
```

Nodes are tasks; edges are data dependencies. Independent nodes run
parallel (one lane each); an edge gates the dependent wave. One node, one
owner. Read this graph before the execution gate; if the work doesn't
match it, fix the work or fix the graph — never leave them disagreeing.

## Main-session guard (orchestrator never codes)

Applies only inside an orchestration loop. The main session is the
orchestrator, not an implementer. It NEVER edits implementation code or
design docs — whatever paths the project declares in its `AGENTS.md` — nor
any skill/config file, and never calls a mutating tool against them.

The orchestrator writes only the tracking plane directly:
`status/<plan>/` (`plan.md`, `status.md`, `lanes/<lane>.md`,
`report.md`), `status/TIMELINE.md`, and `icm_memory_store`. It also drives
isolate, gates, review, PR, CI, and merge — it does not produce the diff.

Delegation by node type (matches the graph):
- **Application-behavior mutation nodes → luvus lane(s) only.** Lane roles:
  `swe` (implementation), `designer` (design artifacts). Simple = exactly
  one lane. Complex = one lane per track (1..N). A lane runs foreground in
  its own luvus pane so progress is visible; the pane persists through the
  loop for inspection + reuse (never detached, never background) and is
  closed only when the plan reaches DONE/FAILED (§5 plan close-out); its
  return still lands on disk first (§4.2).
- **Non-behavior upkeep mutation nodes → `steward` subagent** (steward is
  subagent-only, so it is never a lane). Runs foreground, ONE at a time
  (never alongside another mutating subagent), scoped to its node's named
  files, never commits/pushes/tags. It edits the shared control checkout
  (no worktree isolation), so the gate is hardened — see "Hardened gate for
  mutating subagents" in Phase 5. A behavior change discovered mid-node →
  WAIT + re-dispatch to a `swe`/`designer` lane.
- **Read-only nodes → `subagent` tool.** `architect` = single foreground
  (inline, blocking) call. `researcher` = foreground by default, but MUST
  fan out when a wave needs ≥2 independent lookups (read-only →
  collision-free; `researcher` may itself fan out leaf
  `explore` children). `reviewer` = one per lane,
  fanned out background/async across the review wave, each joined to its
  own lane before that lane closes out. Roles: `architect` (design/plan),
  `researcher` (codebase/web lookup), `reviewer` (review). They never
  mutate; their agent md `model:` pin applies to child sessions
  automatically — no `--model` needed.

A mutation the orchestrator makes itself is a violation: stop, revert it
before proceeding, and re-dispatch the work to the correct plane (behavior
→ lane; non-behavior upkeep → `steward` subagent). Design artifacts
that must land as files: the project's design artifacts → `designer` lane;
decision records / specs → merged into the project's design authority
docs; implementation-plan content → folded into `status/<plan>/plan.md`,
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
+ role agents + resolved model+variant (from the agent md; question tool,
no defaults), read-only roles used, worktree path(s) + branch name(s),
autonomy envelope (worktree → branch → commit → push → PR → auto-merge on
green CI). User approves → Phase 4 isolates first, then runs with zero
further questions. User rejects/changes → adjust the plan (goal Phases
0–3), re-present. No approval = no execution. Approval lapses after 72h or
if the goal text changed → re-present only the diff, not the whole gate.
Worktrees/branches always derive from latest `main` at dispatch;
post-approval main movement is handled by rebase-before-PR, not by
re-gating.

Fast path: triage = simple (all § Routing conditions hold) → gate
collapses to goal restatement + one scope line. Ack = any reply without
rejection or change request ("gas", "oke", "lanjut", 👍 all count;
"tunggu", "jangan", "ubah X" do not). Proceed on ack.

## Jev judgment layer (advisory)

When `jev-mcp` is reachable: a cheap typed pre-filter at the gate, background dispatch/return, review wave, and pre-merge — ADVISORY only, never replacing the human gate, the `reviewer`, CI, or the evidence rule. Contract: `references/jev-layer.md`.

## Phase 4 — Execute (zero questions from here)

### 4.1 Isolate FIRST (mandatory, every route)

1. `git fetch origin main`; confirm `.worktrees/` is gitignored and no
   branch/path collision (`git worktree list`,
   `git branch -a | grep <name>`). Control-checkout dirt is EXPECTED
   (other agents share it) — never require a clean control checkout,
   never branch from its working tree.
2. Create the worktree(s) with the `references/lane-dispatch.md` guards:
   simple → one plan worktree `git worktree add -b <branch>
   .worktrees/<plan> origin/main`; complex → one per lane
   `.worktrees/<plan>-<lane>` (`<plan>` = work-plans folder name; suffix
   on collision, never reuse). Set up inside each: run the project's
   declared install/setup, copy secrets only if a smoke needs them (never
   commit them), and run the project's baseline check to confirm clean.
   `status/<plan>/` stays in the control checkout (tracking plane) — code
   work never touches control-checkout files after this point.
3. `git worktree add` failing (branch/path collision) → FAST EXIT naming
   the cause — never proceed unisolated in the control checkout.
4. Clean check INSIDE the fresh worktree: `git status --porcelain` —
   clean expected there; dirty from an unknown source → WAIT + report,
   never build on top of it.

### 4.2 Dispatch — the prompt IS the delegated subgraph

Follow `references/lane-dispatch.md` for the exact order (guards →
worktrees → master+grid layout → agent → prompt → read return file). Lane
roles by DISCOVERY, never hardcoded IDs: `swe` (implement/fix), `designer`
(design artifacts), `steward` (non-behavior upkeep; behavior change →
WAIT + re-dispatch). luvus agent kinds name backends, not roles — the role travels
in the brief. If no fitting agent exists, keep the lane WAIT and report the
gap; never invent an agent name.

Layout (design-graph variant C, built once per wave by
`scripts/lane-layout.ts`): the orchestrator keeps a fixed left master column
at full height; lanes tile a balanced grid to the right (target tile aspect
~2:1), never a widening row of skinny columns. luvus exposes no pane
geometry, so the grid is chosen from a nominal 160x48 area and lanes beyond
`--max-per-tab` (default 6) move to extra lane-only tabs — never squeezed.
One lane, one pane, one owner; each pane's cwd is its worktree.
`lane-layout.ts` requires ≥1 lane; at N=0 it is not called (planning: no lane
panes, master full width). The grid holds across N=1 (master + one lane) and
overflow; a finished lane's pane persists through the loop
(scrollback for inspection, reusable for a follow-up), so the grid reflows
only when a pane closes — and the orchestrator closes every lane pane at
plan DONE/FAILED (the only close point), never leaving an orphan tile.

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
                commit secrets
Boundary:       cwd <absolute worktree>; branch <branch>; no commit, no push
```

Model: dispatch with an explicit `--model provider/model#variant` plus
`--agent <role>`. Resolve the ref by reading the role agent's markdown
`model:` field (`~/.config/opencode/agents/<role>.md`) and pass that exact
base+variant. Never hardcode, guess, or invent one. If the role agent md
has no `model:`, use the gate-approved ref in `plan.md` (R); if neither
exists → FAST EXIT naming the gap. The default model errors (auth), and
an agent's `model:` field does NOT auto-apply to a primary
`opencode run --auto --agent` session (child/subagent sessions only) — which is
why it must be read and passed explicitly.

Forbidden in every lane brief (opencode `--auto` approves what is not
denied): act outside the assigned worktree, exfiltrate data beyond
declared fetches, `--force` or history rewrites on shared branches,
commit secrets. Violation kills the lane.

Dispatch is deterministic (pinned forms in `references/cli-reference.md`
and `references/lane-dispatch.md`; never probe `--help`). luvus has no
opencode kind, so lanes are driven with the canonical runner via
`luvus pane run <pane> bash <runner>`, which in turn calls
`opencode run --auto --model <...> --agent <role> "<brief>"` (message
positional, no `--prompt`). The lane runs foreground in its own pane — the
user watches progress there; it is never detached or backgrounded, and the
pane persists through the loop so scrollback stays and the pane can be
reused for a resume/follow-up; it closes only at plan DONE/FAILED (the
orchestrator's close point, §5). Completion is still a durable file, not
pane scrollback:
the runner atomically writes the lane report/return to `<slug>-return.md`
LAST (with an `rc=` line — `rc=0` is real completion, `rc≠0` → FAST
EXIT/WAIT), then exits back to the pane's own shell. Wait with
`bun ~/.agents/skills/orchestration/scripts/lane-wait.ts <return-file> [timeout-ms]`
(file-sentinel watch + Effect timeout — never fixed `sleep`, never
`luvus wait output`); the runner-file vehicle is prescribed in
`references/lane-dispatch.md` step 4.

### 4.3 Return — the reply IS the implemented graph

The lane persists its return to `<slug>-return.md` (the sentinel) at DONE;
the pane stays open through the loop, but that file — not pane scrollback —
is the implemented graph. Reply style: caveman-compressed EXCEPT `reviewer`, which
runs full prose (compression drops review nuance). Every lane return carries:
```
Implemented: <files changed + what changed>
Evidence:    <gate output tails + full log path>
Deviations:  <extra/missing/renamed nodes vs the delegated subgraph>
Open:        <blockers, if any>
```

Lane rules: a lane that hits a contract mismatch or needs out-of-scope
files flips to WAIT and reports — never guesses. Lanes may run their own
inline subagents while files/scopes don't collide. The orchestrator's
read-only `subagent` calls (`architect`/`researcher`/`reviewer`) MUST NOT
touch anything already delegated; the one mutating subagent (`steward`,
non-behavior upkeep) is serialized and gate-checked ("Hardened gate for
mutating subagents", Phase 5); the orchestrator never edits files itself.

Lane lifecycle: the lane agent exits at DONE and the runner returns its
pane to the shell — the pane persists through the loop (live progress was
visible there and the scrollback stays for inspection/reuse), so the
persisted `<slug>-return.md` is still the record. Reuse the pane for a
follow-up or resume a lane that died BEFORE done with opencode `--session`
(state lives in the worktree, re-brief from the lane file). Keep worktree +
branch until its PR merges (never delete early; the reviewer still reads
it); removal needs explicit user approval. The pane is closed only at plan
close-out (§5), never per lane mid-loop. Each lane runs `git status` FIRST
inside its own worktree — clean expected there; dirty from an unknown
source → WAIT + report, never build on top of it (control-checkout dirt is
irrelevant — lanes never touch it).

## Phase 5 — Verify + loop (guarded)

Gate per route (lane runs its own row; orchestrator re-runs it at
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
   `status/<plan>/**` (orchestrator-only tracking plane), a lane's files,
   or anything already delegated.
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
lane green + met → spawn its reviewer immediately (async) and let it run;
a lane red or unmet → adjust the plan, record the deviation, next loop
iteration.

Review wave (async, per lane): every lane gets a reviewer pass
(correctness, scope, edge cases) before its PR — run the jev review
pre-filter first (§ Jev judgment layer). Spawn one `reviewer` per
lane as a background `subagent` at once — read-only, so the fan-out is
collision-free. Bind each reviewer to its own lane (stable reviewer↔lane
map); findings return to that lane only, never around it. A lane closes out
(commit/push/PR) as soon as its own reviewer is green — lanes are
edge-independent; `report.md`/DONE stay wave-level (all lanes closed). A
reviewer that fails or times out is NOT green — retry it or self-review
that lane; a missing reviewer is never a pass. No reviewer discoverable →
orchestrator self-reviews against a checklist (diff matches lane scope,
acceptance re-checked, edge cases probed, staged names secret-free) and
records it in the report. Lane findings live in the lane file (+ TIMELINE
line); `report.md` is owned by the orchestrator and aggregates lanes.

Auto close-out (per lane): a lane that is green + met with its own reviewer
pass recorded always commits on its branch (conventional message, body =
WHY), pushes (`git push -u origin <branch>`), and opens a PR (base `main`,
body = result + gate tails + deviations). Lanes are edge-independent, so
each closes out the moment its own review clears — no waiting on sibling
lanes. Invoking `/goal` (or `/orchestrate`) plus the approved gate is the
explicit ask for exactly the enumerated lifecycle. Then the merge gate
takes over: PR auto-merges when CI is green. CI red → fix loop (counts
toward the loop guard); unfixable within budget → leave open + report.
Merge BLOCKED BY POLICY (e.g. required-human-review rule, not red CI) →
leave open + report immediately, never burn loop iterations polling it.
Worktree/branch removal after merge needs no approval inside the loop; keep
them until merged, then clean up. `status/` is gitignored — reports travel
via the PR body, not the repo.

Plan close-out (plan reached DONE/FAILED): once every lane in the plan is
closed out (PRs merged, or terminally parked/reported), or the plan closes
FAILED at the hard cap, the orchestrator runs cleanup in this order —
(1) close every lane pane it created: `luvus pane close <pane-id>` for each
lane in the plan's grid (never a pane it did not create; an overflow
lane-only tab is closed with `luvus tab close <n>` after its panes are
gone); (2) remove each merged lane's worktree + branch; (3) finalize the
tracking plane — the single owner: run
`bash ~/.agents/skills/work-plans/scripts/plan-check.sh <plan>` and, when
`jev-mcp` is reachable, the work-plans closure judgment (`work-plans`
§ Jev judgment); then write `report.md` / `status.md` (`state: DONE` or
`FAILED`) / `status/TIMELINE.md` + `icm_memory_store`. Closing panes is part of
DONE/FAILED close-out — never leave lane panes open once the goal is
reached or the plan is closed. A pane-close failure is non-fatal: report it
and continue cleanup. The plan is not DONE until its panes are closed.

Report progress per wave as: state, commit sha, one-line test summary,
concerns (if any) — nothing else.

## Break points (E — coordinator failures, handled outside the happy path)

- **FAST EXIT** (that lane only; name the cause, never fall back
  silently): `LUVUS_ENV` ≠ `1`; `luvus`, `opencode`, or `bun` missing in the
  pane; `git worktree add` branch/path collision; approved model erroring
  at dispatch (never substitute another model — cost/behavior was
  approved as-is); no `--model` resolvable for a lane.
- **WAIT** (park the lane, continue others, report the blocker): contract
  mismatch; needs out-of-scope files; no fitting agent; clean-check
  failure inside the worktree from an unknown source.
- **Steward lane scope bleed**: a `steward` lane meets an application-
  behavior change → WAIT + report and re-dispatch that node to a
  `swe`/`designer` lane; steward never absorbs behavior changes (its remit
  is non-behavior upkeep only).
- **Lane dead before return persisted**: `<slug>-return.md` is
  missing/empty → WAIT + re-dispatch (resume the pane with opencode
  `--session` when state remains); the return file — not scrollback — is
  the record.
- **Lane return with rc≠0**: the runner finished but the lane failed
  (auth/model/lane error) — the file is not a green signal; treat per the
  error (FAST EXIT/WAIT), never proceed to review.
- **Reviewer fan-out**: a reviewer that times out or fails is not green —
  retry it or self-review that lane; the reviewer↔lane map stays stable, a
  review never crosses to a sibling lane.
- **Jev unavailable/abstain**: the advisory judgment layer is skipped and
  the loop falls back to the existing reviewer path — never a blocker,
  never a completion signal.
- **Loop guard**: max 3 iterations on the same wave without progress —
  progress means ≥1 newly-green acceptance item or gate since the last
  iteration. No progress → park that lane WAIT, continue others, note the
  blocker. Hard cap 5 wave iterations per plan → close as FAILED with
  blockers listed (`report.md` records what shipped), never spin forever.
  Same point failing twice → change strategy first.
- **Secrets/credentials exposure**: the only halt-everything — kill that
  lane immediately and report.
- **Merge-blocked-by-policy**: leave open + report, never poll.

## Edge cases

Non-optional traps — dirty worktree, shared-file collisions,
rebase-before-PR, files-are-truth (incl. post-compaction recovery), and
plan-env hygiene: `references/edge-cases.md`. Read it before closing a wave.

## Standing guardrails (every loop)

- Main-session guard: the orchestrator edits ONLY the
  `status/` tracking plane (`status/<plan>/**`, `status/TIMELINE.md`) +
  memory. Implementation code and design docs (whatever the project's
  `AGENTS.md` declares) are never edited by the main session — behavior
  mutation goes to a luvus lane (`swe`/`designer`), non-behavior upkeep
  mutation to the `steward` subagent (serialized + hardened gate), read-only
  work to a `subagent` (`architect`/`researcher`/`reviewer`). A self-made
  edit is a violation: revert it + re-dispatch.
- Repo bindings, before touching code: load the project's declared design
  authority in the order its `AGENTS.md` gives (typically schema → layers
  → API → design artifacts → architecture rationale). Names and
  invariants verbatim. Docs conflict → STOP + report, never resolve alone.
- Destructive or irreversible steps (migrations, deletes, deploys,
  force-push, history rewrites) are auto-approved INSIDE lane
  branches/worktrees only — blast radius ends at the PR. Hard forbidden,
  no exceptions: mutating `main` outside PR flow, force-pushing shared
  branches, touching prod data, committing secrets (staged-name check runs
  before every commit; a hit kills the lane and is reported).
- Git guardrails before any git mutation (single trunk — the
  `git-workflow` skill). Branch → PR → merge, never commit on `main`.
  Invoking `/goal` or `/orchestrate` covers close-out only for the
  lifecycle enumerated at the execution gate and approved there. After
  isolate, every code mutation (edit, gate, commit) runs inside the
  assigned worktree — never in the control checkout. Stage files
  explicitly, check staged names for secrets.
- Design-artifact-first for UI: the project's design authority + its build
  before implementation.
- Conventional commits (`feat|fix(scope): subject`, body = WHY).
- Submodule rule: if the project uses submodules, commit+push inside the
  submodule first, then bump the pointer in the parent.
