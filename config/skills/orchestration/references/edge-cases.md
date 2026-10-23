# Edge cases (checklist — non-optional)

Traps that recur across waves. Read this before closing a wave.

- Dirty worktree: clean check runs INSIDE the fresh worktree; dirty from
  an unknown source → WAIT + report. Control-checkout dirt is expected
  (shared with other agents) and never blocks isolate, because worktrees
  branch from `origin/main`, not the working tree.
- Shared-file collision: migrations numbering, CHANGELOGs, submodule
  gitlinks, and lockfiles are shared even when features look disjoint.
  Assign one owner at protocol time; on collision risk, serialize those
  files through one lane.
- Rebase before PR: main moves under lanes. Rebase each lane on latest
  `main` + re-run its gate before opening the PR. A PR open through
  review/CI can also be overtaken by `main` — re-check mergeability before
  merge; rebase + re-run if needed (only a diff-changing rebase needs a
  re-review). CI red caused by the rebase → fix loop (counts toward the
  loop guard).
- Files are truth: a native worker's completion is runtime evidence and is
  not durable (the coordinator's own view can be compacted). Lane progress
  lives in `$PLAN_DIR/lanes/` + `$PLAN_DIR/report.md`. After context
  compaction, re-read `$PLAN_DIR/plan.md` + those lane files AND run
  `mem_session_summary` + `mem_context` before continuing — never assume file
  or memory state. If memory is unreadable, proceed on files alone and note it.
- One coordinator, one plan: a second plan offered mid-loop is not absorbed.
  Pause it and require a separate user-authorized harness instance; no
  cross-plan writers or shared ownership. A coordinator writes only its own
  `$PLAN_DIR`.
- Plan-env hygiene: when opening a genuinely new plan, suffix its name
  (date/slug) if `$PLAN_DIR` already belongs to another plan. Resume, reopen,
  and findings-driven replanning retain the existing plan identity after
  verifying ownership; preserve its completed steps, PRs, and loop counters.
  Tracking stays under `$PLAN_ROOT` (resolved
  by `plan-root.sh`), outside the control checkout and every worktree; no lane
  brief or implementation writes there, and no in-repo status directory is
  created. The shared `TIMELINE.md` is append-only and written only through
  `plan-event.sh`; never rewrite, truncate, or replace it. Every lane brief
  sets cwd to the assigned worktree and uses the toolchain the harness already
  exposes (missing tools = declare deviation, use closest equivalent).
