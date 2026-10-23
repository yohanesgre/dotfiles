---
name: work-plans
description: Create, track, and work through plans in the external work-plans state root using design-thinking. Default execution is the current session implementing the graph and ordered steps in one dedicated git worktree; orchestration is explicit opt-in only. Use whenever the user mentions work plans, status plans, opening or closing a plan, plan stubs, lanes inside a plan, plan templates, TIMELINE.md, plan findings, or organizing plan artifacts outside the repository.
metadata:
  requires:
    - design-thinking
---

# Work Plans

One folder per plan under the external work-plans root. A plan is a unit of
work (a feature, a fix batch, a grind). The default is one plan, one worktree,
and the current session doing the implementation. Planning does not imply
orchestration.

## Storage root

All tracking artifacts live outside every repository and worktree, in the XDG
state directory. Resolve the root once per session:

```sh
PLAN_ROOT=$(bash ~/.agents/skills/work-plans/scripts/plan-root.sh)
PLAN_DIR="$PLAN_ROOT/<plan>"
```

`plan-root.sh` prints only the absolute root: it creates no directory and
writes no file, and it fails clearly outside Git (no cwd fallback). It prints
the CANONICAL tracking root and rejects any candidate whose resolved path
equals or sits under the current worktree, the Git directory, the Git common
directory, or any linked worktree; an external `XDG_STATE_HOME` symlink is
accepted only when its resolved path is external. Consumers use that output
directly for owner and lock paths — never reimplement containment lexically.
The root is
`${XDG_STATE_HOME:-$HOME/.local/state}/work-plans/<repo>-<hash>`, where `<repo>`
is the readable repository name and `<hash>` is the full SHA-256 of the
canonical absolute Git common directory. Linked worktrees share that common
directory, so they resolve the same root; same-named repositories and clones
in other paths never collide. A supplied `XDG_STATE_HOME` must be absolute;
unset or empty falls back to `$HOME/.local/state`. Roots and paths may contain
spaces, so quote both variables.

Tracking never lives in the repository or a worktree: no `status/` directory,
no symlink pointing into the repo, no implicit legacy fallback, and runtime
state is never copied back into the repository. Specs, ADRs, and
implementation code stay in the repository; runtime plans do not.

One coordinator (one harness instance) owns one executing plan and writes only
its own `$PLAN_DIR`. A second concurrent plan needs its own coordinator; no
cross-plan runtime writers or shared ownership. An explicitly selected `/goal`
command center may plan unowned outcomes and supervise their separate
coordinators, but does not become their implementation owner. This does not
change standalone work-plans execution. The shared `TIMELINE.md` is never
rewritten by a coordinator — append one event at a time through the helper:

```sh
bash ~/.agents/skills/work-plans/scripts/plan-event.sh \
  <plan> <PLAN|WAIT|WORKING|DONE|FAILED> "<one line>" <plan>/plan.md
```

The helper validates the named plan's existing artifact, rejects multiline or
`|`-bearing messages and unsafe paths, and appends atomically under
`flock` (lock at `<root-parent>/.locks/<repo-id>.timeline.lock`, outside the
active root).

Root layout:

```
$PLAN_ROOT/
  TIMELINE.md                # append-only events, written only via plan-event.sh
  <plan>/                    # name: safe basename over [a-z0-9-]
    plan.md                  # X, scope, design graph, worktree, acceptance, steps, findings
    status.md                # 3-line heartbeat, overwritten on significant actions
    lanes/                   # ONLY for explicitly orchestrated parallel tracks
      <lane>.md
    report.md                # written once at close (DONE | FAILED)
  archive/
    YYYY-MM-DD-<plan>/       # archived whole plan folders
```

No loose files at the root of `$PLAN_ROOT` except `TIMELINE.md`. Finished plans
stay in place until explicitly archived; archiving moves the whole folder to
`$PLAN_ROOT/archive/YYYY-MM-DD-<plan>/`. Plan names are a safe basename over
`[a-z0-9-]`; anything else (including `.` and `..`) is rejected at the
boundary.

## Default workflow

1. Load `design-thinking` and its task-relevant reference. Read the problem
   (X), draw the implementation graph (A), identify break points (E) and
   dependencies (R), then create a bounded plan with scope, dependency-ordered
   waves, exact files, and runnable acceptance checks. For interfaces, include
   Surface<C,V,N>.
2. Resolve `PLAN_ROOT`/`PLAN_DIR` and open the plan there.
3. If the user asked only for a plan, stop after writing and validating it. Do
   not create a worktree or start implementation.
4. When execution is requested, create or resume one dedicated worktree under
   the project's git rules, then implement the steps directly in the current
   session in dependency order.
5. Verify the changed behavior and compare implementation to the design graph;
   fix the code or update the graph if they diverge. Record evidence and close
   the plan.

Do not offer an orchestration menu, dispatch implementation lanes, start extra
harness sessions or panes, or load `orchestration` by default. Use it only when
the user explicitly requests orchestration or invokes its dedicated flow
(`/orchestrate` or `/goal`).
Task count, risk, and independent steps do not opt a plan into orchestration.

This skill owns the plan lifecycle and tracking artifacts; `writing-plans` can
supply detailed implementation-plan authoring. Neither requires orchestration.
Explicit orchestrated callers retain ownership of dispatch, gates, and integration;
they use the optional lane rules below rather than the default execution path.

## Open a plan

```sh
mkdir -p "$PLAN_DIR"
cp ~/.agents/skills/work-plans/assets/plan-template.md "$PLAN_DIR/plan.md"
```

Fill it in.

Plan identity is collision-checked before writing: if `$PLAN_DIR` already
holds another plan, pick a suffixed/date name for genuinely new work; resume,
reopen, and findings-driven replanning reuse the existing folder only after
verifying it belongs to this work (scope, worktree/branch, prior events), and
preserve its completed steps, PRs, and counters. Never overwrite or merge two
plans into one folder, and never let a second coordinator write this one.
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
`$PLAN_DIR/plan.md` directly and preserve these tracking fields.

Then write `$PLAN_DIR/status.md`:

```
state: PLAN
ts: <epoch>
msg: <one line: what + why>
```

Record the open event through the helper (never write the shared TIMELINE
directly):

```sh
bash ~/.agents/skills/work-plans/scripts/plan-event.sh \
  <plan> PLAN "<one line: what + why>" <plan>/plan.md
```

Why the 3-line heartbeat: readers (human or agent) see plan state in one glance
without opening the full plan. Detail lives in `plan.md`, never in `status.md`.

## Work the plan
### Isolate before implementation


Tracking stays under `$PLAN_ROOT`, outside every checkout, so tracking updates
can never redirect implementation into the control checkout. Run all
implementation edits, setup, checks, and runtime smoke scenarios in the recorded
worktree; use absolute paths or explicit tool working directories.

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

On every significant action, overwrite `$PLAN_DIR/status.md` with fresh `ts`:

```
state: WORKING
ts: <epoch>
msg: <one line: latest step>
```

Blocked → `state: WAIT` with a msg naming the blocker; never leave a blocked
plan silently WORKING.

### Optional orchestration tracking

Only an explicitly orchestrated flow uses lane tracking. Lanes are native
workers of the coordinator's own harness instance (never a new harness per
lane), and one coordinator owns one plan. One file per parallel
lane under `$PLAN_DIR/lanes/` uses the same 3-line heartbeat. The plan-level
`status.md` summarizes the slowest lane; it never dumps lane logs. A lane flips
DONE only when its PR merges (or it is terminally parked); while review/CI is
open it stays WORKING with the PR in its msg. Review and CI close per lane;
only required dependency joins gate later waves.

The orchestration template's `gate:` records its execution-gate acknowledgment
(`<ISO8601> <who> <branch>`); `iter:` records `W<n>i<m>`. Omit unused fields.
Its optional `## Tasks` maps atomic crumbs per splitting lane: one table under
each `### <lane>` heading, with `id` (`T1`…), `owner`, comma-separated real
`files`, `resources` (`—` for none), `acceptance`, exact `gate` command, and
direct predecessor `edges`. Crumbs without a direct edge must be file- and
resource-disjoint. Omit `## Tasks` unless a lane actually splits.

Reopened work flips out of DONE first: any new request on a DONE plan (commit,
fixup, follow-up) → overwrite `status.md` to WORKING/WAIT before acting, then
record the event with `plan-event.sh <plan> WORKING "<one line>" <plan>/plan.md`.
Never act on a DONE plan while it still reads DONE.

## Findings loop (same plan, not a new folder)

Any failed completion check, review, CI run, or smoke scenario is a finding in
the existing plan. Append it under `## Findings` in `$PLAN_DIR/plan.md`: finding
ID, source (check/review/CI/smoke), evidence, affected lanes/files, fix steps,
dependencies, verification command, and resolution evidence. New fix work
belongs to the affected wave or a new dependent wave in that same plan; never
create a plan folder per fix.

- Preserve completed steps, merged lanes, their worktrees and open PRs, and the
  original frozen acceptance. Re-enter only the unfinished or affected work.
- Re-run the plan graph and affected checks before resuming. Findings do not
  reset the iteration/no-progress counters (orchestration caps them); otherwise
  replanning could loop forever.
- A finding that changes scope, contracts, or authorization needs explicit
  approval before implementation. It never reauthorizes arbitrary git actions:
  commit, push, PR, merge, and worktree removal stay governed by `git-workflow`.
- Never silently weaken acceptance to make a check pass. Record a deviation or
  replan with approval instead.

## Close a plan (DONE)
For default execution, DONE means the scoped implementation and acceptance
checks are complete, not that a PR merged. Record whether changes are
uncommitted or awaiting integration; do not claim they shipped. Keep the
worktree and branch for review or follow-up. Commit, push, PR, merge, and
worktree removal remain separate actions governed by `git-workflow`.
Explicit orchestrated flows keep their own merge-based close-out rules.


DONE requires every frozen acceptance criterion to hold with recorded evidence.
If any criterion is unmet, append findings and fix waves and keep working
(replan); do not flip DONE because the listed waves ended.

For default execution, DONE means the scoped implementation and acceptance
checks are complete, not that a PR merged. Record whether changes are
uncommitted or awaiting integration; do not claim they shipped. Keep the
worktree and branch for review or follow-up. Commit, push, PR, merge, and
worktree removal remain separate actions governed by `git-workflow`.
Explicit orchestrated flows keep their own merge-based close-out rules.

1. Write `$PLAN_DIR/report.md`:

```md
# Report: <plan>
created: YYYY-MM-DD
sessions: <session ids>
result: <what was implemented, worktree/branch, integration state>
tests: <command + one-line output each>
deviations: <contract breaks, or "none">
```

2. Run `plan-check.sh -- <plan>` (and the jev closure judgment when reachable)
   against the written report; red → fix the artifact, never flip DONE.
3. Flip `$PLAN_DIR/status.md` to `state: DONE` with fresh `ts`.
4. Record the `DONE` event and report link through the helper:
   `plan-event.sh <plan> DONE "<one line>" <plan>/report.md`.
5. Save to memory (`mem_save`): 3–5 point summary + resolved artifact paths
   (`$PLAN_DIR/plan.md`, `$PLAN_DIR/report.md`). Never duplicate full report
   content into memory — memory is the index, the files are the source.

## Close a plan (FAILED)

Acceptance cannot be met and work is being closed: write `$PLAN_DIR/report.md`
the same way (`result: failed — <what was implemented>; blockers: ...`), flip
`$PLAN_DIR/status.md` to `state: FAILED`, then record the event with
`plan-event.sh <plan> FAILED "<one line>" <plan>/report.md`. Use WAIT
instead when work is blocked but expected to resume.

## Chronology

Two durable sources: `$PLAN_ROOT/TIMELINE.md` (events) and folder names under
`$PLAN_ROOT` / `$PLAN_ROOT/archive` (`YYYY-MM-DD` prefixes). Repository git
history does not track runtime chronology. The TIMELINE is append-only and
single-writer-per-event: append through `plan-event.sh` (never rewrite,
truncate, or replace the shared snapshot). The graph still works when one
source is missing (no gate), so a forgotten event is a minor escape, not a
break — backfill it through the helper when noticed.

## Break points (fix the artifact, not the reader)

| Node | Break | Treatment |
|---|---|---|
| open | `plan.md` without scope Out | add Non-scope before work starts |
| open | invalid plan ID (not `[a-z0-9-]`) | reject at the boundary; pick a safe basename |
| work | `status.md` grows past 3 lines / log dump | move detail to `plan.md` or `report.md` |
| lanes | lane file with no parent plan | delete or attach to a plan |
| DONE | no `report.md` | don't flip to DONE until written |
| DONE | unmet frozen acceptance | append findings + fix waves (replan); never DONE |
| FAILED | no `report.md` | write `report.md`, then flip FAILED |
| state | undefined value (e.g. `PARTIAL`) | use the AGENTS.md enum; FAILED + blockers |
| reopen | act on a DONE plan without flipping status | flip to WORKING first + a `plan-event.sh` WORKING event |
| memory | `mem_save` without artifact path | amend with path — a pointerless summary is lost |
| root | loose file in `$PLAN_ROOT` | move into a plan folder or archive |
| timeline | direct write, rewrite, or truncation of shared `TIMELINE.md` | append only through `plan-event.sh`; preserve foreign events verbatim |
| ownership | second plan opened in the same coordinator | give it a separate harness instance/coordinator; no cross-plan writers |
| tracking | runtime state appears in the repo/worktree | move it to `$PLAN_ROOT`; never symlink or fall back |

## Validate

Run `bash ~/.agents/skills/work-plans/scripts/plan-check.sh -- <plan>` at open and
before flipping DONE/FAILED. It resolves the same external root and checks
scope Out, 3-line heartbeats, the TIMELINE entry, no loose files, the state enum
(`PLAN|WAIT|WORKING|DONE|FAILED`), safe plan IDs, and DONE/FAILED-has-report.
When a plan declares `## Tasks` it also checks crumb rows, edge targets,
Acceptance/`verify:` coverage, and per-lane file/resource disjointness; plans
without `## Tasks` are unaffected. Red → fix the artifact, then re-run.

For migration staging only, `plan-check.sh --root <absolute existing root> -- <plan>`
validates that tree directly (the `--` keeps option-shaped safe names valid).
It never falls back to repository status or to
the resolver; staging trees are the only use.

## Migrate legacy `status/` artifacts

Legacy in-repo `status/` folders are read-only sources. Discovery covers the
control checkout and linked worktrees; pause every tracking writer first.

```sh
bash ~/.agents/skills/work-plans/scripts/migrate-status.sh --dry-run
bash ~/.agents/skills/work-plans/scripts/migrate-status.sh --apply --writers-paused
```

`--dry-run` is the default and makes no filesystem writes; it prints a JSON
summary on stdout (sources, destination, conflicts, invalid plans,
backup/staging/quarantine metadata) with diagnostics on stderr. Repeat
`--source <absolute status dir>` to restrict inventory to named dirs; apply
still inventories EVERY known root and blocks when a nonempty omitted root
exists — no partial shared-root success. `--apply` requires `--writers-paused`.

Apply stages on the destination filesystem, backs up outside the repository,
keeps a manifest of original paths and checksums, validates every staged plan
with `plan-check.sh --root <staging-root> -- <plan>`, and activates only a
complete validated destination. It holds the shared
`<root-parent>/.locks/<repo-id>.timeline.lock` under `flock` throughout apply,
the same lock `plan-event.sh` uses. Take owner and lock paths directly from
the resolver's CANONICAL output — `plan-root.sh` already rejects any candidate
whose resolved path is inside a checkout, so never reimplement containment
lexically in migration code. It copies plans, archive entries, reports, and
TIMELINE events into staging, rewriting tracking links (never implementation
paths or historical evidence). Staging, backup, and manifest metadata live
outside the active root, which stays limited to `TIMELINE.md`, plan folders,
and `archive/`.
If the destination store already exists, stage the combined store conflict-free;
never overwrite it in place. Apply stops without overwriting on collisions,
invalid plans, unsafe symlinks, tracked or unknown source contents, source
mutation, or lock conflicts. Never resolve a conflict by timestamp, overwrite an
existing plan, or delete a source first. Invalid legacy artifacts block
activation until fixed or explicitly dispositioned; never invent completion
evidence.

Retirement NEVER recursively deletes a live source. Each migrated source is
atomically renamed into a retained external quarantine — `<meta>/quarantine`
when it is on the same filesystem, otherwise a safe quarantine on the source
filesystem across a filesystem boundary; if neither is possible, apply blocks
and leaves the source untouched. The durable manifest records
`retirement.quarantined` and `recovery` as source→quarantine maps; the JSON
report claims `single_authority=true` only after every retirement is verified.

After activation, verify lookups from the control checkout and a linked
worktree. Update memory pointers through the memory tools; never rewrite the
memory database directly. Apply retires only the migrated sources; a tracked or
unknown source stops the run instead (normal repository change review applies).
No symlink or runtime fallback remains. Keep the backup and quarantine outside
the repository until the migration is accepted. Recovery authority comes from
the JSON `activation`/`report` information and durable manifest, never from the
exit code alone.
Before activation, a blocked/failed run leaves the original authoritative.
After activation, a source race, source recreation, or quarantine/manifest
mismatch leaves an `activated-unretired` store: preserve ALL sources and
quarantined copies, keep writers paused, reconcile them with the verified
backup and manifest maps, and explicitly establish one authority before
resuming or rolling back.

Rollback: pause writers first, preserve and reconcile every event written to
the new store since activation, restore the backed-up source, then switch
authority. Never run both stores as active; a failed staging or validation
leaves the source untouched.

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

Failure mode: jev unreachable, errors, outside its allowed file root, or
`abstain` → skip; fall back to `plan-check.sh` + the rules above. Never a gate.
The external tracking root may sit outside that file root: send bounded artifact
text or skip the advisory pass, never copy tracking into the repository.

## Non-scope

Planning-only requests never start implementation. Execution stays within the
plan's scope and recorded worktree; it does not authorize automatic commits,
pushes, PRs, merges, or worktree deletion. Follow `git-workflow` for those actions.
Live migration of existing status artifacts requires explicit authorization and
paused writers; the migration script never runs implicitly. Plan names use
`[a-z0-9-]`; anything else is rejected at the boundary.
