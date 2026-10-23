# Crumb execution (atomic sub-waves inside a lane)

A plan may declare per-lane atomic crumbs (`work-plans` `## Tasks`; fields
id/owner/files/resources/acceptance/gate/edges). When it does, the lane's
work runs as file/resource-disjoint sub-waves instead of one serial brief.
No `## Tasks` → the lane runs exactly as one native worker, one result.
The lane still integrates, the coordinator owns git, runs the lane gate, and
closes the one PR (unchanged).

An "already-proven disjoint" set means `plan-check.sh` validated per-lane
file/resource disjointness for those rows. If disjointness is not proven, do
not split — serialize the crumbs through one worker.

## Manifest

The coordinator RE-RENDERS one TSV beside the worktree:
`<worktree>/../<prefix>-tasks.tsv`. One crumb per line, TAB-separated;
`files` and `resources` are space-separated (`-` = none):

```
lane<TAB>crumb<TAB>files(space)<TAB>resources(space|-)<TAB>gate
```

The file is re-rendered PER READY SET — same path, containing only the crumbs of
the set about to fire — so `snapshot`/`check`/`rollback` each see just that set's
rows. `resources` is informational for `lane-verify.sh` (recorded, never acted
on); resource disjointness is plan-check's job.

## Sub-wave dispatch (inside ONE lane worktree)

Repeat per ready set. Ready = edges satisfied; a set is maximal and
file/resource-disjoint.

1. Snapshot BEFORE the set fires (the manifest holds only this set):
   `bash scripts/lane-verify.sh snapshot <worktree> <snapdir> <manifest>`
   Clear the set's expected result artifacts
   (`<worktree>/../<prefix>-<crumb>-return.md`) before firing (or re-firing)
   the set — a stale result from a previous attempt satisfies the join
   instantly, so the per-join verify then runs against unfinished work.
2. Fire the set — one bounded native crumb WORKER per crumb, each assigned the
   SAME lane worktree + branch, the crumb's file/resource set as its exclusive
   ownership, and the lane's resolved role/model (workers may not choose
   another model). Crumb workers never commit, push, or write tracking.
3. Join the set with the discovered native completion surface. No polling, no
   pane, no secondary harness. The coordinator then persists each crumb's
   structured result (plan/lane/crumb/attempt identity + evidence) to
   `<worktree>/../<prefix>-<crumb>-return.md`; workers never write it.
4. Verify BEFORE the next set fires:
   `bash scripts/lane-verify.sh check <worktree> <snapdir> <manifest>`
   Re-runs each gate, scope-checks files, and appends `verified rc=` markers to
   `<worktree>/../<prefix>-<crumb>-return.md` (the coordinator-persisted result).
5. On GREEN, the COORDINATOR commits that set's paths before the next ready set
   fires. An uncommitted green set is absent from the next set's re-rendered
   manifest, so `check` would flag it UNCLAIMED and invite a false rollback.
   Then dispatch the next ready set.

Serial crumbs — those the graph marks unsafe to overlap — run one at a time as
a single worker; they never overlap a sibling.

## Caps

- Sub-wave width = min(ready set, harness concurrency cap); excess crumb
  batches later.

## Failure

- Snapshot is taken BEFORE the set fires. On red, roll back with
  `bash scripts/lane-verify.sh rollback <worktree> <snapdir> <manifest>` — NEVER
  `git restore`/reset to HEAD: a serial predecessor may share a scope.
- Dependents of a failed crumb block; unrelated sets keep running.
- Bounded retry ×1: re-dispatch the UNCHANGED brief once. Still red → the lane
  absorbs the crumb within scope, or flips FAILED.
- The lane gate cannot go green with an open crumb.

## Namespace rule

ALL writers — crumb workers AND any serial/integration run in the lane
worktree — must hold disjoint namespaces. Unsure → fall back to serial.
