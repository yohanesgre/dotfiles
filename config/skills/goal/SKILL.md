---
name: goal
description: Goal-driven execution loop — breakdown a user goal, deepen with design graphs, protocol the work, track in work-plans, then hand the frozen plan to the `orchestration` skill to execute in isolated luvus lanes until done. Use ONLY when the user invokes `/goal`. This skill is `/goal`-scoped and does not govern ordinary sessions, other commands, or other agents.
metadata:
  requires:
    - orchestration
    - work-plans
---

# Goal

Turn a goal prompt into DONE through a loop. This skill owns the goal
lifecycle: intake → classify → design → protocol → track. Once the plan is
frozen and the execution gate is approved, it hands off to the
`orchestration` skill, which owns execution (isolate → lanes → verify →
review → merge → loop). The loop ends only when acceptance criteria hold
and gates are green — never on effort spent.

Scope: this skill runs ONLY under an explicit `/goal` invocation. Its
guard and policies do NOT apply to ordinary sessions, other commands, or
other agents. Outside `/goal`, the global/repo AGENTS.md rules govern.

Autonomy: planning is human-gated (goal clarity, design direction,
protocol + model/effort approval); the execution gate is the LAST human
gate. After it, execution is full-auto and owned by `orchestration` — the
user reads wave reports async and the loop never blocks on them. Approving
the gate pre-authorizes exactly the lifecycle `orchestration` enumerates
(branch → commit → push → PR → auto-merge on green CI) for exactly the
named lanes/branches. The gate approves scope and waves.

Runtime: opencode (v2) only; execution runs on luvus lanes. Exact pinned
CLI signatures live in the `orchestration` skill
(`orchestration/references/cli-reference.md`) — the ONLY forms to use;
never probe `--help` (`luvus help all` is the single sanctioned discovery
command, and only outside a lane). If this session is not opencode, STOP
and flag before doing anything.

## Requires

- `orchestration` — the execution plane. Load it at the handoff (after
  Phase 3 + the frozen plan) and follow it from the execution gate onward.
- `work-plans` — the tracking-plane rules. Load it at Phase 3 to open the
  plan; `orchestration` re-loads it for in-loop heartbeats and close-out.

## The graph (this skill IS the pipeline for it)

```
A — happy path
goal → intake → classify → design → protocol → track → GATE
     [execution owned by the `orchestration` skill:]
     → isolate → wave{lanes} → verify → review-wave{reviewer_i ∥}
     → per-lane close(PR) → merge → loop: next wave | DONE

E — planning break points (coordinator failures, not worker failures)
wrong context · missing input (invisible edge) · misinterpretation ·
ambiguous scope · missing acceptance · architecture fork · docs conflict
[execution break points (luvus/env/model/lane/reviewer): see `orchestration`]

R — every lane prompt (built at protocol time) carries
subgraph (nodes+edges) · WHY · governing docs · acceptance · gate · forbidden
```

Nodes are tasks; edges are data dependencies. Independent nodes run
parallel (one lane each); an edge gates the dependent wave. One node, one
owner. Read this graph before Phase 0; if the work doesn't match it, fix
the work or fix the graph — never leave them disagreeing. The execution
half of this graph (lane lifecycle, execution break points, the
delegated-subgraph boundary) is owned and detailed by the `orchestration`
skill.

## Phase 0 — Intake + triage

1. Take the goal from the invocation (`/goal <text>`) or ask for it.
   (`/goal` with no goal is the ONE case that waits for user input.)
2. Break the goal into work items (what must be true when done, not how).
3. Ambiguous scope, missing acceptance, or architecture fork → ask the
   user with the question tool (this is the human-gated planning zone).
   Never guess on architecture; state what you would otherwise do.
4. Triage the route BEFORE designing, using § Routing. Isolation is NOT
   triaged: every route executes in a fresh worktree (orchestration Phase 4
   isolate, after work-plans + gate) — never in the invoking checkout, which
   other agents share. The orchestrator never edits code in any route.
   - **Simple**: exactly one mutation lane in the single plan worktree.
   - **Complex**: one mutation lane per track — one worktree + pane +
     agent each; a single-track complex task is still one lane.
   State the chosen route + lane count + why in one line before proceeding.

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
(`orchestration` re-uses this same routing at the execution gate.)

## Phase 1 — Deepen (design before protocol)

- UI/surface work → `design-thinking`: draw Surface<C,V,N> first. C =
  happy-path content flow, V = void states
  (empty/loading/partial/error/denied), N = needs
  (data/permission/prior-step/viewport).
- Backend/state work → `design-thinking`: A = happy-path call graph,
  E = break points, R = dependencies.
- Orchestration work → the graph above (execution half in `orchestration`)
  + `design-thinking/references/graph-protocol.md`: nodes, edges, waves,
  E, R. Compare the delegated subgraph vs the implemented graph before
  any gate; extra/missing node = off-script.
- Read-only reasoning nodes run here as `subagent` calls: `architect`
  (brainstorm/design/ADR/plan), `researcher` (lookup). Their output feeds
  `plan.md`; nothing they produce bypasses the gate. A `writing-plans`
  artifact is input, not a second plan of record: `status/<plan>/plan.md`
  stays the single source — fold its files/tasks/tests into
  `R`/`Graph A`, and persist the plan doc only if acceptance requires it
  (mutation lane, linked from `plan.md`). The artifact's own execution
  handoff (subagent-driven / inline) is overridden — execution is always
  the orchestration lane model.
- Skill missing → fall back to the behavior described inline, record the
  gap in the lane/plan.
- Conflicting docs or requirements → STOP, report, wait. No scope creep:
  report missing pieces, don't build them.

## Phase 2 — Protocol (wave graph)

Order waves by dependency, not enthusiasm. Independent tracks may run in
parallel; an edge gates the dependent wave (e.g. the project's
design-artifact lane DONE — edit + build green — before any
implementation lane starts). Name lanes, assign one owner per node, and
assign file ownership per lane so parallel tracks never write the same
files. Write the wave graph into `plan.md`.

## Phase 3 — Track (work-plans)

One folder `status/<plan>/` (name `[a-z0-9-]`). Open it per the
`work-plans` skill: copy
`~/.agents/skills/work-plans/assets/plan-template.md` → `plan.md`, fill
X / Scope / Graph A / E / R / Lanes, write `status.md`
(`state: PLAN`, `ts`, `msg`), append the PLAN line to `status/TIMELINE.md`.
`ls status/` shows active plans only; no loose files in `status/` root
besides `TIMELINE.md`.

Fill the template's graph sections — this skill's graph IS the plan:
- **Graph A**: the wave graph (waves + lanes, one owner per node).
- **E**: execution break points (see `orchestration` § Break points).
- **R**: the delegated subgraph per lane — role agent + resolved
  model+variant, nodes (files/units), edges (inputs consumed, outputs
  produced), acceptance, gate. Resolve the model from the role agent's
  markdown `model:` field (`~/.config/opencode/agents/<role>.md`); the
  agent md is the single source of truth for model+effort.
- **Lanes**: only when parallel. The simple route is one track → delete the
  section and skip `lanes/` (never invent a lane to fill the shape).
- Header `gate:` = execution-gate ack (`<ISO8601> <who> <branch>`);
  `iter:` = current `W<n>i<m>`.

Freeze acceptance in `plan.md` BEFORE any lane executes: one verifiable
criterion per work item, each paired with its verify command (the
project's gate commands — typecheck, touched test suites, manual smoke).
Waves verify against this frozen list — never invent new acceptance
mid-execution.

**Reopen rule**: any new request on a DONE plan → flip `status.md` to
WORKING first + TIMELINE line, then act. In-loop heartbeats (`status.md`
mirroring the slowest lane, 3-line lane files) and the DONE close-out —
including `icm_memory_store` — are owned by `orchestration` § Plan close-out;
this section states only the artifact rules applied at open. `report.md`
follows the work-plans report template. Tracking artifacts have their own
break points (3-line overflow, orphan lane, DONE-without-report, pointerless
memory save) — fix the artifact per `work-plans`, don't duplicate them here.
Finished plans stay in `status/` until archived; archiving is outside `/goal`.

Prefix lane status msgs with `W<n>i<m>` so loop position survives scrollback.
Validate tracking at open with
`bash ~/.agents/skills/work-plans/scripts/plan-check.sh <plan>`; when
`jev-mcp` is reachable, also run the work-plans open judgment
(`work-plans` § Jev judgment) before the execution gate. (The pre-DONE
plan-check + closure judgment are owned by `orchestration`.)

## Handoff — execution is owned by `orchestration`

After Phase 3 the plan is frozen. Load the `orchestration` skill and follow
it from the execution gate onward: it owns the gate (LAST human gate), the
main-session guard, the simple/complex lane routing, Phase 4
(isolate/dispatch/return), Phase 5 (verify/loop/review/merge/plan
close-out), the break points, and the standing guardrails. This skill's
loop is complete when `orchestration` reaches DONE/FAILED and the tracking
plane is finalized.

`/orchestrate` loads the same skill directly when a frozen plan/wave graph
already exists and only execution remains.

## Close-out

The tracking-plane close-out is owned by `orchestration` (§ Plan
close-out): it writes `report.md`, flips `status.md` to DONE/FAILED,
appends the TIMELINE line, runs `plan-check.sh` + the jev closure judgment,
and `icm_memory_store`s. Goal's loop ends at the handoff — it does not touch
tracking artifacts after that. Finished plans stay in `status/` until
archived; archiving is outside `/goal`.

## Guardrails (goal side)

- The main session writes ONLY the `status/` tracking plane
  (`status/<plan>/**`, `status/TIMELINE.md`) + memory. It never edits
  implementation code, design docs, or skill/config files — behavior
  mutation goes to a luvus lane, non-behavior upkeep to `steward`, read-only
  work to a `subagent`. A self-made edit is a violation: revert + re-dispatch.
  Full execution guardrails (worktree isolation, lane roles, destructive-step
  policy, git guardrails) are owned by `orchestration`.
- Repo bindings, before touching code: load the project's declared design
  authority in the order its `AGENTS.md` gives (typically schema → layers
  → API → design artifacts → architecture rationale). Names and
  invariants verbatim. Docs conflict → STOP + report, never resolve alone.
- Design-artifact-first for UI: the project's design authority + its build
  before implementation.
