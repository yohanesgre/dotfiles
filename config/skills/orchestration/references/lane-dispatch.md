# Lane dispatch (behavior + read-only routes)

Application-behavior mutation runs through a native lane worker: simple
route = exactly one lane in `.worktrees/<plan>`; complex route = one lane per
track (`.worktrees/<plan>-<lane>`). Non-behavior upkeep that needs a worktree
or branch (release prep) runs as a `steward` lane the same way; in-place
upkeep runs as a `steward` native subagent in the control checkout
(serialized, hardened gate — `SKILL.md` Phase 5). Read-only roles are native
read-only subagents too: `architect` runs as a single foreground call;
`researcher` runs foreground but MUST fan out (foreground `explore` children)
for ≥2 independent lookups; `reviewer` may fan out async (one per lane,
read-only → collision-free).

One coordinator (one harness instance) owns this plan. Lanes are native
subagents of that same instance — never a second harness, session, pane, or
model CLI. Protocol detail (discovery, dispatch batch, join, structured
result, run log): `references/native-dispatch.md`.

Order matters within a lane; across a wave, lanes run concurrently. Steps
1–2 run once per wave (guards, worktrees); step 3 fires EVERY ready lane of
the wave before the join at the end of step 4. Serialize only what the graph
marks unsafe to overlap (shared files) or mandates serial (the in-place
`steward` subagent, one at a time). Any FAST EXIT stops that lane only; others
continue.

1. New mutation-worktree guards (only when creation is authorized):
   ```sh
   git fetch origin main
   git worktree list                  # no path collision
   git branch -a | grep <branch>      # no branch collision
   ```
   Control-checkout dirt is EXPECTED (other agents share it) — never gate
   on it. The clean check runs INSIDE the fresh worktree (step 2b). Confirm
   the native dispatch/join/resume forms and roles from
   `native-dispatch.md` § Discover first; a missing native capability is
   WAIT, never a process fallback.
2. Isolate at the exact approved path and branch. For a simple H2H plan,
   reuse its prepared plan worktree only after verifying canonical path,
   branch, repository, approved base and permitted prior changes, current
   plan/attempt ownership and no other live/unknown writer. Do not suffix,
   reset or replace it. Unknown ownership/dirt → WAIT.
   Otherwise create only the named authorized worktrees from the approved
   base (normally origin/main): simple `.worktrees/<plan>`, complex
   `.worktrees/<plan>-<lane>`. A collision is FAST EXIT, never permission
   to reuse another plan's tree or select a suffix outside the gate.
   Once every assigned tree exists, run approved setup/baseline concurrently
   at those exact paths; never use prefix globs. Unknown dirt → WAIT.
   Read-only roles skip fetch, worktree creation and mutation setup.
3. Dispatch: mutation lane roles are `swe`/`designer`, plus `steward` for
   worktree/branch chores (release prep); in-place non-behavior upkeep and
   read-only roles run as native subagents, not worktree lanes. Resolve each
   lane's role + model ONLY through harness-supported agent configuration or
   options, or the gate-approved `plan.md` choice; record it in the lane
   record. Workers may not silently choose another model. Write the brief
   (subgraph + structured result contract) and dispatch the native worker
   scoped to the lane's absolute worktree and branch. Fire the whole wave
   back to back (one pass over the wave's lanes) BEFORE awaiting any handle;
   honor the harness concurrency cap and queue the excess. No nested
   coordinator/harness, no pane, no TTY/environment check.
4. Join the wave with the discovered native completion surface. Do not poll
   artifact files or infer completion from elapsed time. A wait timeout is
   not a dead lane: re-await, then resume the SAME lane/attempt in the same
   worktree (state lives there); only an unrecoverable native failure is
   WAIT + re-dispatch. Failed lane result or missing evidence → not green.
5. The coordinator persists each completed result and its evidence/findings in
   `plan.md`'s lane-attempt section. Keep `$PLAN_DIR/lanes/<lane>.md` strictly
   three heartbeat lines with a pointer in `msg`. Record state changes via
   `plan-event.sh` and optionally append the advisory run-log lane event
   (`native-dispatch.md` § Run log). Read-only children write no reports.
6. Brief = the delegated subgraph (`orchestration/SKILL.md` §4.2): WHY, Nodes
   (files + lines, one owner), Edges (inputs consumed / outputs produced),
   Governing docs, Acceptance (frozen), Gate (verify commands), Forbidden,
   Boundary (absolute worktree path + cwd, branch, no-commit, no tracking
   writes), Result contract.
7. Result = the implemented graph (`orchestration/SKILL.md` §4.3), read from
   the native completion: identity, Implemented, Evidence (gate tails + log
   path), Deviations, Open. Replies caveman-compressed, except `reviewer`
   (full prose). The coordinator compares it to the delegated subgraph and
   persists it.
8. Plan close-out (goal reached) — once every lane is closed out (PRs
   merged, or terminally parked/reported) or the plan closes FAILED, the
   coordinator removes only cleanup-authorized merged lane trees/branches
   with no live/unknown writer. Keep its active coordinator cwd until verified
   shutdown, then perform any separately authorized deferred cleanup.
   Finalize tracking (`report.md`, three-line `status.md`, closure event,
   `mem_save`). Record retained trees and cleanup failures; never remove an
   unmerged tree or treat a parked required outcome as success.
