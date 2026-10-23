---
name: goal
description: Goal intake, design-thinking, decomposition and acceptance. One plan hands off inline to orchestration; multiple plans keep the active session as command center and use one separate coordinator harness per executing plan through H2H. Use ONLY for an explicit /goal invocation, not ordinary work-plans or unrelated sessions.
metadata:
  requires:
    - design-thinking
    - work-plans
    - orchestration
---

# Goal

Own the overall goal, not every plan's implementation. Keep one plan of record
per independently deliverable outcome. `work-plans` owns tracking;
`orchestration` owns one plan's execution and native lane subagents.

These rules apply only to explicit `/goal`. Ordinary work-plans remains
standalone and does not opt into orchestration because it has several steps.

## Roles and routing

Choose the role before execution and preserve it:

- **Planning only:** intake, design and tracked plans; no worktrees, processes,
  branches, execution or activation merely because a plan was saved.
- **One plan:** this session may become its inline `/orchestrate` coordinator.
  No additional harness is needed. Load `orchestration` at that handoff.
- **Multiple concurrent plans:** this session remains the command center.
  Dispatch one separate coordinator harness per ready plan through H2H;
  each coordinator runs `/orchestrate` with its own native lane subagents.
  Two concurrent plans use three harness instances including the center.

UI, database and backend work within one feature are usually lanes/waves,
not three plans. Separate plans only when outcomes and acceptance can stand
on their own. A plan's internal dependencies belong to its coordinator;
only cross-plan dependencies belong to the center.

An already-running inline coordinator cannot silently become a multi-plan
center while retaining its old ownership. Complete or explicitly hand off
that ownership under verified shutdown, or use a separate center session.
A coordinator never invokes `/goal` to bootstrap another center.

## Design graph

```text
/goal -> intake + design-thinking -> bounded plans + dependencies
      -> frozen acceptance + execution approval
      -> one plan: inline /orchestrate
      -> multiple plans: command center
           -> reserve ready plans -> H2H start coordinator per plan
           -> native lane execution inside each coordinator
           -> verify outcome evidence -> release dependent readiness
           -> all required outcomes + goal acceptance -> aggregate report

plan findings -> owning coordinator -> same plan's planning step
cross-plan conflict -> center -> revise affected graph + approval
```

## Intake and design

1. Read the goal from the invocation; `/goal` without a goal asks for it.
2. Load `design-thinking` and the relevant reference. Identify X (problem),
   draw A (flow), identify E (breaks) and R (dependencies). For an interface,
   include Surface<C,V,N>. Read the repository's design authority first.
3. Specify independently verifiable outcomes, scope In/Out, acceptance,
   files/contracts/resources, prerequisite evidence and failure handling.
   Resolve material missing scope or architecture choices with the user.
4. Classify internal lane work within each plan through `orchestration` at
   execution time. File count alone neither splits plans nor creates lanes.
5. Use read-only native consultations for research/design when needed. They
   are not separate plan coordinators and cannot bypass the execution gate.

## Plan and approval

Resolve tracking with the existing work-plans resolver. Author each plan
in `$PLAN_ROOT/<plan>/plan.md`, not a second copied task list. Record its
exact intended worktree/branch/base, dependency-ordered waves, checks,
acceptance and findings. Keep heartbeats exactly three lines with existing
states `PLAN|WAIT|WORKING|DONE|FAILED`. Append shared timeline events only
through `plan-event.sh`; never create repo-local `status/` directories.

Before execution, freeze and obtain approval for:

- the plan graph and required outcome/evidence contracts;
- each plan's scope and approved revision;
- exact worktrees/branches, coordinator harness and any explicit model choice;
- coordinator concurrency, native-worker limits and shared resources;
- named permitted lifecycle/git/tool actions per plan.

Launching a coordinator does not authorize commit, push, PR, merge, rebase,
deployment, production changes or destructive cleanup. A gate covers only
its explicitly enumerated actions. Changed scope/contracts/authorization
invalidate affected approvals; never weaken original acceptance to pass.

For one plan, hand the frozen plan to `orchestration`, which owns its
execution gate, lane lifecycle and close-out. Do not create a manager or
extra coordinator just to wrap that inline handoff.

## Multi-plan command center

Read `references/command-center.md` for the H2H request contract, progress
and recovery limits. Use the native `h2h_control` tool in OMP or OpenCode;
its shared runtime owns registry mutations and process control. If the tool
or a required capability is unavailable, WAIT with the missing prerequisite;
never replace it with shell-launched harnesses, terminal scraping or Luvus
message passing.

The center may plan unowned artifacts. After exact-plan ownership ACK, only
that plan's coordinator writes its runtime artifacts. The center writes its
own external registry and aggregate report, and sends findings/instructions
through H2H instead of editing a running child plan. Native lane workers
never write coordinator tracking or another plan.

For every ready plan:

1. Validate approved revision, predecessor evidence, conflicts/resources,
   concurrency and authorization. Worktree separation alone does not make
   shared contracts, lockfiles or migrations safe to run together.
   Prepare the exact approved coordinator worktree through the repository's
   git/setup workflow before H2H start. Preparation is not implementation and
   needs its own named branch/worktree approval; a missing worktree blocks
   launch instead of falling back to the control checkout.
2. Persist reservation and launch intent before starting a process. Require
   real runtime/session identity and exact plan/revision/attempt ACK before
   execution. A locally generated request ID is not a harness session ID.
3. Dispatch only that plan's `/orchestrate` brief. Choose the coordinator
   independently of the center: OMP→OMP, OMP→OpenCode, OpenCode→OMP and
   OpenCode→OpenCode use the same H2H control core over ACP.
4. Supervise via H2H status/wait and semantic progress. Each coordinator
   dispatches, joins and resumes its own native lanes; the center does not
   become their lane-level orchestrator.
5. Inspect the report and acceptance evidence for the current approved
   revision. Record verification explicitly before unblocking dependents.
   An ended ACP turn, process exit, parked lane or cached DONE is not proof.

Independent approved plans may continue when another plan blocks. Dependent
plans remain WAIT until their exact required evidence is verified.

## Progress and findings

Keep coordinator lifecycle, plan state and observation freshness separate.
ACP activity updates are not durable plan progress. Use coordinator-owned
artifacts and validated structured reports for waves, lanes, blockers and
results. Unknown values remain unknown; do not invent percentages.

The shared observer coalesces read-only artifact refreshes without repeated
model prompts. Use status/wait for meaningful changes: phase/wave changes,
blockers, pending permission, failed checks and verified completion. Do not
flood the user with token events or unchanged snapshots. A quiet long tool
is not automatically dead; show observation age and actual wait context.

A failed check/review/CI/smoke adds findings to the **existing owning plan**:
evidence, affected work, fix steps/dependencies and verification. Restart
from that plan's planning step, then execute and verify affected work.
Preserve completed steps, merged work, PRs, frozen acceptance and iteration/
no-progress counters. Do not create a new fix plan for each finding.

Escalate cross-plan conflicts, changed acceptance/authorization, invalidated
predecessors and ambiguous ownership to the center. Replan only affected
outcomes and obtain renewed approval where required.

## Recovery and stopping

- One live coordinator owns a canonical repository+plan across all centers.
  Repeated requests return recorded outcomes, not duplicate launches.
- A timeout, lost ACK, disconnected pipe or stale heartbeat means unknown
  outcome. Keep ownership/resources reserved and reconcile actual state.
- Load/resume of stored history is not live-process reattachment. Never use
  latest-session/--continue guesses or adopt a running session by loading it.
- Preserve explicit session IDs, attempts, exact worktrees and accumulated
  evidence. Reject identity drift rather than silently updating the owner.
- Cancel only the recorded turn; it can leave native children running.
  Stop requires actual owned-runtime shutdown/quiescence. Unknown shutdown
  stays RECONCILING; never release resources because a cancel returned.
- Do not kill processes by harness name, delete live worktrees or reset
  registry files to recover. Native permissions and configured services
  depend on effective runtime policy; ACP is not an OS sandbox.

## Goal completion and guardrails

The center verifies every required child outcome and the goal-level
acceptance. Failed/cancelled/parked work is not success. Record the aggregate
outcome alongside the external goal registry, referencing original child
reports rather than rewriting or duplicating them. Preserve integration
state: uncommitted or awaiting integration is not shipped.

Inside `/goal`, the center does not implement code, edit design/config files,
or run a second plan through its own mutation subagents. Each plan's
coordinator owns that work under `orchestration`; inline mode follows that
same single-plan skill. Preserve repository git guards and read-only review
boundaries. Do not activate changed configuration without approval.
