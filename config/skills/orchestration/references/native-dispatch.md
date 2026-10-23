# Native dispatch (lane protocol)

Lanes are built-in native subagents of the coordinator's CURRENT harness
instance. One coordinator (one harness instance) owns one plan; lanes never
get their own harness process, session, terminal pane, or model CLI. There is
no shell runner, no TTY/environment marker, and no file-sentinel join: the
native dispatch handle and its completion are the runtime signals, and the
coordinator-persisted artifacts are the recovery truth.

## Discover first (never invent)

At loop start, read the harness's documented agent/subagent surface and the
coordinator's own available tools. Record the discovered forms in the plan's
`R` section:

- the native dispatch tool/form and the role names it accepts;
- how a dispatch handle is awaited — join, completion event, or the harness's
  documented result surface (never fixed `sleep`, never output scraping);
- how an incomplete worker is resumed in the same session/task/worktree;
- the harness concurrency cap;
- the harness-supported role/model option (agent configuration or per-dispatch
  option).

Use ONLY those discovered forms. Do not invent tool names, require a vendor or
version, pass fixed CLI syntax, or launch another harness/`... run` command as
a fallback. Missing native parallel dispatch, join, or resume capability →
WAIT + report the capability gap. A harness that can dispatch but not join
still runs lanes SERIALLY, one at a time.

The coordinator maintains `iter: W<n>i<m>` and an explicit `next_action: ...`
header in its own `plan.md` before work and when the approved action changes.
Blank or absent metadata means unknown; unchecked future tasks are not a
declared current action. Keep status and lane heartbeats exactly three lines;
WAIT messages name the actual blocker and requested action.

## Order (once per wave)

Steps 1–2 run once per wave; step 3 fires every independent ready lane before
step 4 joins any of them. Serialize only what the graph marks unsafe to
overlap (shared files) or mandates serial (the in-place `steward` subagent).

1. Confirm native dispatch/join/role discovery from § Discover first.
   Missing capability is WAIT, never a process fallback. For mutation lanes,
   apply the authoritative guards in `lane-dispatch.md` steps 1–2.
2. Isolate and set up through those same rules: ownership-verified prepared
   worktrees retain their exact approved identity/base; new trees need named
   creation approval and collision checks. Unknown ownership/dirt → WAIT.
   Run setup concurrently only after every assigned tree is ready. Read-only
   roles skip fetch, creation and mutation setup.
3. Dispatch the wave as a BATCH: issue every ready lane's native worker
   before awaiting any handle. One lane, one native worker, one worktree, one
   branch, and a disjoint file/resource set. Resolve role + model ONLY through
   the harness-supported agent configuration/option or the gate-approved
   choice in `plan.md`; record resolved role+model in its lane-attempt section.
   Workers may not silently choose another model, and no lane gets a second
   harness, pane, or nested coordinator.
   - Honor the harness concurrency cap: queue the excess and dispatch it as
     soon as a handle completes. No unbounded fan-out; a worker does not
     re-dispatch coordinators.
   - Brief = the delegated subgraph (`orchestration/SKILL.md` §4.2): WHY,
     Nodes (files + lines, one owner), Edges (inputs consumed / outputs
     produced), Governing docs, Acceptance (frozen), Gate (verify commands),
     Forbidden, Boundary (absolute worktree path + cwd, branch, no commit, no
     push, never write `$PLAN_DIR` or the shared TIMELINE), plus the
     structured result contract (§ Structured result).
4. Join via the discovered native completion surface (`wait`/result event).
   - A timeout or missing completion is NOT a dead-lane verdict and never
     success: re-await, then resume the SAME lane/attempt in the same
     worktree; only an unrecoverable native failure flips WAIT + report.
   - Do not poll artifact files to infer completion, and do not spawn a
     replacement harness to "check" a lane.
5. Persist the result (coordinator only). Validate the structured result
   against the lane's identity (`plan`, `lane`, `attempt`), the delegated
   subgraph, and the evidence rule. Keep `$PLAN_DIR/lanes/<lane>.md` strictly
   the three-line heartbeat (`state`, `ts`, `msg`). Persist the structured
   identity, result, evidence, and findings in `plan.md`; the heartbeat message
   points to that lane-attempt section. Append lane state-change events through
   `plan-event.sh`.
   Optionally append the advisory run-log lane event:
   `runlog.sh lane plan=<plan> lane=<lane> role=<role> model=<model>
   worktree=<worktree> start_ms=<n> end_ms=<n> dur_ms=<n> rc=<rc>`
   (logging failure never fails the lane). The coordinator summary
   `report.md` stays wave-level.
6. Crumb sub-waves (plan declares `## Tasks`): bounded native crumb workers
   per `references/crumb-execution.md`; only for already-proven disjoint
   files/resources, with `lane-verify.sh` protections and coordinator-only
   git operations. No `## Tasks` → the lane runs as one worker.
7. Close-out per green lane: the coordinator commits (conventional message,
   body = WHY), pushes (`git push -u origin <branch>`), and opens the PR
   (base `main`, body = result + gate tails + deviations) — no reviewer before
   the PR exists. One native reviewer per lane reviews the open PR ∥ CI;
   findings route back to that lane only. A lane keeps its worktree + branch
   until its PR merges; merged worktrees/branches are removed at plan
   close-out under the approved lifecycle.

Read-only roles (`architect`, `researcher`, `reviewer`) stay read-only native
subagents, run in the coordinator's harness, and never write reports — the
coordinator persists their findings.

## Structured result (returned by every lane)

```
plan: <plan>   lane: <lane>   attempt: <n>   role: <role>   model: <resolved>
Implemented: <files changed + what changed>
Evidence:    <gate output tails + full log path>
Deviations:  <extra/missing/renamed nodes vs the delegated subgraph>
Blockers:    <open items, if any>
```

A lane without mission identity or evidence is not green. The coordinator
compares the implemented graph against the delegated subgraph; an extra or
missing node is a deviation, never silently accepted.

## lane-verify (crumb sub-wave verification)

Re-runs each crumb's gate, scope-checks its files, and — once the coordinator
has persisted the crumb's result — appends `verified rc=` markers to
`<worktree>/../<prefix>-<crumb>-return.md`, against a snapshot taken BEFORE
the sub-wave fires:

```bash
bash scripts/lane-verify.sh snapshot <worktree> <snapdir> <manifest>   # before the set fires
bash scripts/lane-verify.sh check    <worktree> <snapdir> <manifest>   # after the join
bash scripts/lane-verify.sh rollback <worktree> <snapdir> <manifest>   # on red; NEVER git-restore-to-HEAD
```

Manifest: `<worktree>/../<prefix>-tasks.tsv` — one crumb per line,
TAB-separated: `lane<TAB>crumb<TAB>files(space)<TAB>resources(space|-)<TAB>gate`.
The coordinator RE-RENDERS it per ready set (same path, only that set's
crumbs); `resources` is informational (never acted on); the optional `[lane]`
argument filters which GATES run, not the declared-files union. After a set
verifies GREEN, the COORDINATOR commits that set's paths before the next set
fires — workers never commit, and an uncommitted green set is absent from the
next re-rendered manifest and would be flagged UNCLAIMED.

## Run log (always-on, advisory)

Lane and plan events append one compact JSON line to the CENTRAL log
`~/.local/state/orchestration/runs.jsonl` (one log for ALL projects; override
with `ORCH_LOG`). Each event carries `repo` automatically — the basename of
the MAIN repo root (resolved via `git-common-dir`), so a lane registered from
`.worktrees/<plan>-<lane>` is attributed to the main repo, not the worktree;
outside a git repo it is `basename $PWD`. `repo` is reserved (like `ts`), so
callers cannot override it. Kinds: `lane` (one per completed lane — plan, lane,
role, model, worktree, start_ms/end_ms/dur_ms, rc) and `plan` (one per plan
close-out — plan, verdict, wall_s, lanes, prs, iter). Writes are guarded
(`command -v jq … || true`): a logging failure never fails a lane/run.
`runlog.sh <kind> k=v …` appends; `run-report.sh [log-file] [out-file]` renders
the aggregate report (lanes grouped by repo/plan, plans, failures, signals,
slowest lanes, recent fixes). `ORCH_REPO=<name>` filters the report to one repo
(unset = all). `ORCH_SINCE=<N>d|<N>h|YYYY-MM-DD` scopes the report to events with
`ts >= cutoff` (composes with `ORCH_REPO`); an empty window prints
"no runs in window" (exit 0), and an invalid value warns and is ignored. No log →
"no runs logged yet". The diagnosis loop
(report → root cause → smallest fix → re-measure) lives in
`references/run-diagnosis.md`; when it lands a change, log it as a `fix` event
(`runlog.sh fix plan=… symptom=… change=… before=… after=…`) so the report's
Recent fixes section carries the history.
