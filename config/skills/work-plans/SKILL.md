---
name: work-plans
description: Create, track, and work through plans in status/ folders using design-thinking. Default execution is the current session implementing the graph and ordered steps in one dedicated git worktree; orchestration is explicit opt-in only. Use whenever the user mentions work plans, status plans, opening or closing a plan, plan stubs, lanes inside a plan, plan templates, TIMELINE.md, or organizing status/ artifacts per plan instead of flat files.
metadata:
  requires:
    - design-thinking
---

# Work Plans

One folder per plan under `status/`. A plan is a unit of work (a feature, a fix batch,
a grind). The default is one plan, one worktree, and the current session doing the
implementation. Planning does not imply orchestration.

## Default workflow

1. Load `design-thinking` and its task-relevant reference. Read the problem (X),
   draw the implementation graph (A), identify break points (E) and dependencies
   (R), then create a bounded plan with scope, dependency-ordered waves, exact
   files, and runnable acceptance checks. For interfaces, include Surface<C,V,N>.
2. If the user asked only for a plan, stop after writing and validating it. Do not
   create a worktree or start implementation.
3. When execution is requested, create or resume one dedicated worktree under the
   project's git rules, then implement the steps directly in the current session.
4. Verify the changed behavior and compare implementation to the design graph;
   fix the code or update the graph if they diverge. Record evidence and close the plan.

Do not offer an orchestration menu, dispatch implementation lanes, open panes, or
load `orchestration` by default. Use it only when the user explicitly requests
orchestration or invokes its dedicated flow (`/orchestrate` or `/goal`).
Task count, risk, and independent steps do not opt a plan into orchestration.

This skill owns the plan lifecycle and tracking artifacts; `writing-plans` can
supply detailed implementation-plan authoring. Neither requires orchestration.
Explicit orchestrated callers retain ownership of dispatch, gates, and integration;
they use the optional lane rules below rather than the default execution path.

## Layout

```
status/
  TIMELINE.md                # append-only, one line per event
  <plan>/                    # name: [a-z0-9-] (e.g. deploy-dashboard)
    plan.md                  # X, scope, design graph, worktree, acceptance, steps
    status.md                # 3-line heartbeat, overwritten on significant actions
    lanes/                   # ONLY for explicitly orchestrated parallel tracks
      <lane>.md
    report.md                # written once at close (DONE | FAILED)
```

No loose files in `status/` root except `TIMELINE.md`. Finished plans stay in place
until explicitly archived (`status/archive/YYYY-MM-DD-<plan>/`); archiving is a
move of the whole folder.

## Open a plan

Copy `assets/plan-template.md` to `status/<plan>/plan.md` and fill it in.
Use `assets/orchestration-plan-template.md` only for an explicitly orchestrated
flow; its dispatch graph, gate, iteration, lanes, and crumb tables are not default
fields. The implementation design graph remains part of every graph-shaped plan.

States: `PLAN | WAIT | WORKING | DONE | FAILED` (mirror of AGENTS.md).
`WAIT` = blocked, msg names the blocker. `FAILED` = closed without meeting
scope; `report.md` is still required.

`plan.md` is the plan of record. Write X, concrete In/Out scope, the
`design-thinking` graph (A), break points (E), and dependencies (R). These describe
the implementation, not worker dispatch. Group `## Steps` under wave headings
(`### W1: ...`, `### W2: ...`). Each wave names its predecessor waves, concrete
steps and files, and a runnable completion check. One wave is enough for a small
plan; add waves where dependencies or verification boundaries justify them.
Record the intended worktree path, branch, and base ref. Mark completed steps as
work proceeds. `## Acceptance` carries plan-level criteria, one per line, each
ending `— verify: <runnable command>`.

Specs, ADRs, and existing implementation plans are linked inputs, not duplicate
plans to maintain. When `writing-plans` authors a new tracked plan, use
`status/<plan>/plan.md` directly and preserve these tracking fields.

Then write `status/<plan>/status.md`:

```
state: PLAN
ts: <epoch>
msg: <one line: what + why>
```

Append one line to `status/TIMELINE.md`:

```
YYYY-MM-DD | <plan> | PLAN | <one line> | status/<plan>/plan.md
```

Why the 3-line heartbeat: readers (human or agent) see plan state in one glance
without opening the full plan. Detail lives in `plan.md`, never in `status.md`.

## Work the plan
### Isolate before implementation

Keep `status/<plan>/` and `status/TIMELINE.md` in the control checkout. Run all
implementation edits, setup, checks, and runtime smoke scenarios in the recorded
worktree; use absolute paths or explicit tool working directories so tracking
updates do not accidentally redirect implementation into the control checkout.

Load `git-workflow` before creating a branch/worktree or integrating changes.
Check the project's worktree convention, ignored path, branch/path collisions,
and base ref. Obtain any approval required by those rules; requesting a plan
does not authorize git lifecycle actions.

Reuse an existing plan worktree only after verifying its path, branch, and
existing changes belong to this plan. Otherwise create one dedicated worktree
(conventional path `.worktrees/<plan>`, branch `omos/<plan>`, from the project's
declared base). Record the actual path, branch, and base in `plan.md` before
implementation. Run declared setup and baseline checks inside it. A failed
creation or unrelated dirty worktree means WAIT with the cause, not a fallback
to implementation in the control checkout.

Execute waves in dependency order in this session, with steps sequential by
default in the same worktree. Verify a wave's completion check before starting
its dependent waves. Independent steps may share a wave; that does not authorize
parallel dispatch. Update checkboxes and the heartbeat with the current wave
after significant actions. Resume from the recorded worktree and first unfinished
wave/step; do not spawn a lane just to execute a plan.

### Heartbeats


On every significant action, overwrite `status.md` with fresh `ts`:

```
state: WORKING
ts: <epoch>
msg: <one line: latest step>
```

Blocked → `state: WAIT` with a msg naming the blocker; never leave a blocked
plan silently WORKING.

### Optional orchestration tracking

Only an explicitly orchestrated flow uses lane tracking. One file per parallel
lane under `lanes/` uses the same 3-line heartbeat. The plan-level `status.md`
summarizes the slowest lane; it never dumps lane logs. A lane flips DONE only
when its PR merges (or it is terminally parked); while review/CI is open it
stays WORKING with the PR in its msg.

The orchestration template's `gate:` records its execution-gate acknowledgment
(`<ISO8601> <who> <branch>`); `iter:` records `W<n>i<m>`. Omit unused fields.
Its optional `## Tasks` maps atomic crumbs per splitting lane: one table under
each `### <lane>` heading, with `id` (`T1`…), `owner`, comma-separated real
`files`, `resources` (`—` for none), `acceptance`, exact `gate` command, and
direct predecessor `edges`. Crumbs without a direct edge must be file- and
resource-disjoint. Omit `## Tasks` unless a lane actually splits.

Reopened work flips out of DONE first: any new request on a DONE plan (commit,
fixup, follow-up) → overwrite `status.md` to WORKING/WAIT before acting, then
append a TIMELINE line. Never act on a DONE plan while it still reads DONE.

## Close a plan (DONE)
For default execution, DONE means the scoped implementation and acceptance
checks are complete, not that a PR merged. Record whether changes are
uncommitted or awaiting integration; do not claim they shipped. Keep the
worktree and branch for review or follow-up. Commit, push, PR, merge, and
worktree removal remain separate actions governed by `git-workflow`.
Explicit orchestrated flows keep their own merge-based close-out rules.


1. Write `status/<plan>/report.md`:

```md
# Report: <plan>
created: YYYY-MM-DD
sessions: <session ids>
result: <what was implemented, worktree/branch, integration state>
tests: <command + one-line output each>
deviations: <contract breaks, or "none">
```

2. Flip `status.md` to `state: DONE` with fresh `ts`.
3. Append TIMELINE line with `DONE` and the report path.
4. Save to memory (`mem_save`): 3–5 point summary + artifact paths
   (`plan.md`, `report.md`). Never duplicate full report content into memory —
   memory is the index, the files are the source.

## Close a plan (FAILED)

Acceptance cannot be met and work is being closed: write `report.md` the same
way (`result: failed — <what was implemented>; blockers: ...`), flip `status.md`
to `state: FAILED`, append the TIMELINE line. Use WAIT instead when work is
blocked but expected to resume.

## Chronology

Three sources, in order of convenience: `TIMELINE.md`, folder/archive names with
`YYYY-MM-DD` prefixes, `git log -- status/`. The graph still works when any one
is missing (no gate), so a forgotten TIMELINE line is a minor escape, not a break —
just backfill it when noticed.

## Break points (fix the artifact, not the reader)

| Node | Break | Treatment |
|---|---|---|
| open | `plan.md` without scope Out | add Non-scope before work starts |
| work | `status.md` grows past 3 lines / log dump | move detail to `plan.md` or `report.md` |
| lanes | lane file with no parent plan | delete or attach to a plan |
| DONE | no `report.md` | don't flip to DONE until written |
| FAILED | no `report.md` | write `report.md`, then flip FAILED |
| state | undefined value (e.g. `PARTIAL`) | use the AGENTS.md enum; FAILED + blockers |
| reopen | act on a DONE plan without flipping status | flip to WORKING first + TIMELINE line |
| memory | `mem_save` without artifact path | amend with path — a pointerless summary is lost |
| root | loose file in `status/` | move into a plan folder or archive |

## Validate

Run `bash ~/.agents/skills/work-plans/scripts/plan-check.sh <plan>` at
open and before flipping DONE/FAILED. It checks scope Out, 3-line
heartbeats, TIMELINE entry, no loose files, the state enum
(`PLAN|WAIT|WORKING|DONE|FAILED`), and DONE/FAILED-has-report. When a plan
declares `## Tasks` it also checks crumb rows, edge targets,
Acceptance/`verify:` coverage, and per-lane file/resource disjointness;
plans without `## Tasks` are unaffected.
Red → fix the artifact, then re-run.

## Jev judgment (advisory — when `jev-mcp` is reachable)

When `jev-mcp` is reachable (`tools["jev-mcp"].*` via `execute`), jev can
judge the tracking artifacts at both ends of a plan. Advisory only:
`plan-check.sh` and the artifact rules above stay authoritative, and a jev
verdict never opens, blocks, or closes a plan.

- **Open (before work starts).** `jev_triage` on `plan.md` (pass it as a
  `path` item — read server-side, never into context) with checks:
  `scope_bounded` (In and Out both concrete), `acceptance_verifiable`
  (every criterion names a runnable verify command), `no_placeholders` (no
  TBD/TODO/empty sections). For explicitly orchestrated plans also check
  `graph_valid` (dependency-ordered waves, one owner per node, no shared-file
  collision), `crumb_disjoint`, and `acceptance_coverage` against gate rows.
  Fix artifact issues before work starts; do not confuse the implementation
  graph with a dispatch graph or invent an orchestration execution gate.
- **Close (before flipping DONE/FAILED).** `jev_check` on a small assembled
  state — the frozen acceptance list from `plan.md` plus `report.md` and
  `status.md`: "does every frozen criterion have matching evidence in the
  report, and do the artifacts agree?" `no`/`uncertain` → fix the artifact
  before the flip.

Failure mode: jev unreachable, errors, or `abstain` → skip; fall back to
`plan-check.sh` + the rules above. Never a gate.

## Non-scope

Planning-only requests never start implementation. Execution stays within the
plan's scope and recorded worktree; it does not authorize automatic commits,
pushes, PRs, merges, or worktree deletion. Follow `git-workflow` for those actions.
Plan names use `[a-z0-9-]`; anything else is rejected at the boundary.
