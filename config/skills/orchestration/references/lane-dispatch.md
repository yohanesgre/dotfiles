# Lane dispatch (behavior + read-only routes)

Application-behavior mutation runs through a luvus lane: simple route =
exactly one lane in `.worktrees/<plan>`; complex route = one lane per track
(`.worktrees/<plan>-<lane>`). Non-behavior upkeep mutation runs as a
`steward` subagent in the control checkout (serialized, hardened gate —
`SKILL.md` Phase 5), never a lane. The `subagent` tool also carries the
read-only agents: `architect` runs as a single foreground call; `researcher`
runs foreground but MUST fan out (foreground `explore` children) for ≥2
independent lookups; `reviewer` may fan out background/async (one per lane,
read-only → collision-free).

Order matters — run top to bottom, one lane at a time (review is the one
async fan-out). Any FAST EXIT stops that lane only; others continue.

All CLI syntax is pinned in `references/cli-reference.md`. Use ONLY those
signatures; never run `--help` (luvus `help all` is the only discovery
command, and it is not part of the lane loop).

1. Guards (control checkout, before worktree creation):
   ```bash
   test "${LUVUS_ENV:-}" = 1          # else FAST EXIT, required: luvus session
   command -v luvus opencode bun      # else FAST EXIT naming binary
   git fetch origin main
   git worktree list                  # no path collision
   git branch -a | grep <branch>      # no branch collision
   ```
   Control-checkout dirt is EXPECTED (other agents share it) — never gate
   on it. The clean check runs INSIDE the fresh worktree (step 2b).
2. Isolate: `git worktree add -b <branch> <worktree> origin/main` where
   `<worktree>` = `.worktrees/<plan>` for the simple route (one lane) or
   `.worktrees/<plan>-<lane>` for complex. `<plan>` = work-plans folder
   name; fails → FAST EXIT naming cause,
   never proceed unisolated. Then per-lane setup inside it (run the
   project's declared install/setup; copy secrets only if a smoke needs
   them — never commit them).
   2b. Clean check INSIDE the worktree: `git status --porcelain` — clean
   expected; dirty from an unknown source → WAIT + report.
3. Layout (once per wave, after all worktrees exist): build the master+grid
   with
   `bun ~/.agents/skills/orchestration/scripts/lane-layout.ts --anchor "$LUVUS_PANE_ID"
   --lanes '<json>'`, where `<json>` = `[{"name":"<lane>","cwd":"<worktree>"}]`
   per lane. It keeps the orchestrator pane as a fixed left master column
   (full height, `--master-ratio`, default 0.34) and tiles the lanes in a
   balanced grid to the right — never repeated same-axis splits into skinny
   columns. Geometry is applied by one atomic UHP `layout.apply` per tab;
   luvus exposes no pane geometry, so the grid is chosen from a nominal
   160x48 area (≈2:1 tiles) and lanes beyond `--max-per-tab` (default 6) go
   to extra lane-only tabs, never squeezed. The script also parks each lane
   shell in its worktree (`luvus pane run <id> "cd '<worktree>'"`) and
   returns per lane `{pane, tab, col, row}` — use those pane ids in step 4.
   Each lane runs foreground in its pane (visible progress); the pane
   persists through the loop for inspection + reuse, and the orchestrator
   closes it at plan DONE/FAILED (step 8).
4. Dispatch (deterministic — use the pinned forms in
   `references/cli-reference.md`; NEVER run `--help`):
   mutation roles are `swe`/`designer`; `steward` (non-behavior mutation)
   and read-only roles run as `subagent`, not lanes. There is no opencode
   kind, so do NOT call `luvus agent start/prompt` for a lane. Write the
   brief to `<worktree>/../<slug>-brief.md` and the canonical runner
   (`cli-reference.md` § Canonical lane runner) to
   `<worktree>/../<slug>-runner.sh`, then dispatch with
   `luvus pane run <pane> bash <abs-runner>` so the lane runs foreground
   in that pane — the user watches live progress there; never detach or
   background a lane. At the end the runner writes the report to
   `<slug>-return.md.tmp` and atomically `mv`s it onto
   `<slug>-return.md` as the LAST step; the pane then returns to its own
   interactive shell — the pane persists so scrollback stays and the pane is
   reusable; close it only at plan DONE/FAILED (step 8), never per lane
   mid-loop. The return file — not scrollback — is the record; its appearance
   means the runner finished — `rc=0` is real completion, `rc≠0` → FAST
   EXIT/WAIT, never green. Wait
   with
   `bun ~/.agents/skills/orchestration/scripts/lane-wait.ts <return-file>
   [timeout-ms]` (file-sentinel watch + Effect timeout — never fixed
   `sleep`, never `luvus wait output`).
   Dispatch invokes exactly
   `opencode run --auto --model <provider/model#variant> --agent <role>
   "<brief>"` (message is positional; there is no `--prompt`). Read
   `--model` verbatim from the role agent's md `model:` field
   (`~/.config/opencode/agents/<role>.md`) and pass it explicitly. The
   default model needs cookie auth (`No cookie auth cred`), and an agent's
   md `model:` pin does NOT auto-apply to a primary `opencode run --auto
   --agent` session (child/subagent sessions only). Check `opencode auth list`
   once up front; a fresh `opencode` boot can fail with a postinstall
   error — record it and switch paths instead of retrying blindly.
   Approved model errors here → FAST EXIT naming the model, never substitute.
5. The lane exits at DONE, the runner persists the return and the pane
   returns to its prompt; the pane stays open through the loop — no live
   agent afterward, but the scrollback and the pane itself persist for
   inspection/reuse. A lane that dies BEFORE done resumes with opencode
   `--session` in the same pane (state lives in the worktree).
6. Brief = the delegated subgraph (`orchestration/SKILL.md` §4.2): WHY, Nodes (files
   + lines, one owner), Edges (inputs consumed / outputs produced),
   Governing docs, Acceptance (frozen), Gate (verify commands), Forbidden,
   Boundary (absolute worktree path, branch, no-commit). Include the lane's
   `--agent` + `--model` (model read from the role agent's md `model:` field).
7. Return = the implemented graph (`orchestration/SKILL.md` §4.3), read from
   `<slug>-return.md` (the pane persists through the loop, but the file is
   the record): Implemented (files + what changed), Evidence (gate tails +
   log path), Deviations (extra/missing nodes vs the delegated subgraph),
   Open. Replies caveman-compressed, except `reviewer` (full prose).
8. Plan close-out (goal reached) — once every lane is closed out (PRs
   merged, or terminally parked/reported) or the plan closes FAILED, the
   orchestrator closes the panes it created:
   `luvus pane close <pane-id>` for each lane in the plan's grid (never a
   pane it did not create; overflow lane-only tabs are closed with
   `luvus tab close <n>` once their panes are gone), then removes each
   merged lane's worktree + branch and finalizes tracking
   (`report.md`/`status.md`/`icm_memory_store`). A pane-close failure is non-fatal:
   report it and continue. Closing panes is part of DONE/FAILED close-out —
   never leave lane panes open after the goal is reached or the plan is
   closed.
