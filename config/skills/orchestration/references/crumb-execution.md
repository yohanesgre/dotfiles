# Crumb execution (atomic sub-waves inside a lane)

A plan may declare per-lane atomic crumbs (`work-plans` `## Tasks`; fields
id/owner/files/resources/acceptance/gate/edges). When it does, the lane's
work runs as file/resource-disjoint sub-waves instead of one serial brief.
No `## Tasks` → the lane runs exactly as today (one runner, one return).
The lane agent still integrates, owns git, runs the lane gate, and closes the
one PR (unchanged).

## Manifest

The orchestrator RE-RENDERS one TSV beside the worktree:
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
   Clear the set's expected return files (`<worktree>/../<prefix>-<crumb>-return.md`) before firing (or re-firing) the set — a stale return from a previous attempt satisfies the join instantly, so the per-join verify then runs against unfinished work.
2. Fire the set — one WORKER PANE per crumb, split off the LANE pane:
   ```bash
   luvus pane split <lane-pane> --auto --no-focus    # -> .result.pane
   luvus pane run <worker-pane> "cd '<worktree>'"    # park in the worktree
   luvus pane run <worker-pane> bash <abs-runner>    # canonical runner
   ```
   The runner is the SAME canonical runner (`cli-reference.md`), one per
   crumb, slug `<prefix>-<crumb>`, brief written per crumb.
3. Join the set:
   `bun ~/.agents/skills/orchestration/scripts/wave-wait.ts <return-file>...`
4. Verify BEFORE the next set fires:
   `bash scripts/lane-verify.sh check <worktree> <snapdir> <manifest>`
   Re-runs each gate, scope-checks files, and appends `verified rc=` markers to
   `<worktree>/../<prefix>-<crumb>-return.md` when that return file already
   exists. Close each worker pane once its set is verified.
5. On GREEN, COMMIT that set's paths before the next ready set fires — the lane
   agent owns git and workers never commit. An uncommitted green set is absent
   from the next set's re-rendered manifest, so `check` would flag it UNCLAIMED
   and invite a false rollback. Then dispatch the next ready set.

Serial crumbs — those the graph marks unsafe to overlap — run in the LANE
pane, never a worker pane; the lane agent runs them itself.

## Caps

- Sub-wave width = min(ready set, tab capacity); excess crumb batches later.
- No pane available → serial fallback in the lane pane.

## Failure

- Snapshot is taken BEFORE the set fires. On red, roll back with
  `bash scripts/lane-verify.sh rollback <worktree> <snapdir> <manifest>` — NEVER
  `git restore`/reset to HEAD: a serial predecessor may share a scope.
- Dependents of a failed crumb block; unrelated sets keep running.
- Bounded retry ×1: re-dispatch the UNCHANGED brief once. Still red → the lane
  absorbs the crumb within scope, or flips FAILED.
- The lane gate cannot go green with an open crumb.

## Namespace rule

ALL writers — worker panes AND the lane agent's serial/integration runs — must
hold disjoint namespaces. Unsure → fall back to serial in the lane pane.
