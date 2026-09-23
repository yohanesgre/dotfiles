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
  `main` + re-run its gate before opening the PR. CI red caused by the
  rebase → fix loop (counts toward the loop guard).
- Files are truth: a pane persists through the loop but is not durable (it can be closed,
  and the orchestrator's own view is compacted). Lane progress lives
  in lane files + `report.md`. After context compaction, re-read
  `plan.md` + lane files AND run `icm_wake_up` + `icm_memory_recall` before
  continuing — never assume file or memory state. If memory is unreadable,
  proceed on files alone and note it.
- Plan-env hygiene: if `status/<plan>/` already exists, suffix the plan
  name (date/slug) — never reuse. `status/` stays in the control checkout;
  the worktree never owns tracking files. Every lane brief pins the binary
  PATH and sets cwd to the assigned worktree (missing tools = declare
  deviation, use closest equivalent).
