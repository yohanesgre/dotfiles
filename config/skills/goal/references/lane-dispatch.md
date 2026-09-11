# Lane dispatch (all mutation routes)

Every `/goal` mutation runs through a herdr lane. Simple route = exactly
one lane in `.worktrees/<plan>`; complex route = one lane per track
(`.worktrees/<plan>-<lane>`). The `subagent` tool is read-only only
(research/review) and never mutates: `architect`/`researcher` run as single
foreground calls; `reviewer` may fan out background/async (one per lane,
read-only → collision-free).

Order matters — run top to bottom, one lane at a time (review is the one
async fan-out). Any FAST EXIT stops that lane only; others continue.

1. Guards (control checkout, before worktree creation):
   ```bash
   test "${HERDR_ENV:-}" = 1          # else FAST EXIT, required: herdr session
   command -v herdr && command -v opencode2   # else FAST EXIT naming binary
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
   `bun ~/.agents/skills/goal/scripts/lane-layout.ts --anchor "$HERDR_PANE_ID"
   --lanes '<json>'`, where `<json>` = `[{"name":"<lane>","cwd":"<worktree>"}]`
   per lane. It resizes the orchestrator pane to a fixed left master column
   (full height) and tiles the lanes in a balanced grid to the right — never
   repeated `--direction right` splits into skinny columns. Tile minimum is
   60x16; overflow (N beyond one tab's capacity) goes to extra lane-only
   tabs, never squeezed. The script sets each pane's cwd to its worktree and
   returns per lane `{pane_id, tab_id}` (+ grid) — use those in step 4. Each
   lane runs foreground in its pane (visible progress); the pane persists at
   DONE for inspection + reuse.
4. Agent: `herdr agent start <name> --kind <backend> --pane <pane-id>`
   (role travels in the brief, not the kind; mutation roles: `swe`,
   `designer` — read-only roles run as `subagent`, not lanes).
   No opencode2 kind exists — drive opencode2 without it: write the lane
   brief to a runner file `<worktree>/../<slug>-runner.sh` (or
   `/tmp/opencode/<slug>-runner.sh`). Run
   `herdr pane run <pane> "bash <runner>"` so the lane runs foreground in
   that pane — the user watches live progress there; never detach or
   background a lane. At the end the runner writes the lane report/return to
   `<slug>-return.md.tmp` and atomically `mv`s it onto `<slug>-return.md` as
   the LAST step, then returns the pane to its shell — DO NOT close the
   pane: it persists so scrollback stays and the pane is reusable. The
   return file — not scrollback — is the record, and the atomic rename means
   the file's appearance can only mean real completion. Wait with
   `bun ~/.agents/skills/goal/scripts/lane-wait.ts <return-file>
   [timeout-ms]` (file-sentinel watch + Effect timeout — never fixed
   `sleep`, never `pane wait-output`).
   `--model provider/model#variant` is required on every lane —
   read it from the role agent's md `model:` field
   (`~/.config/opencode/agents/<role>.md`) and pass it verbatim. The
   default model needs cookie auth (`No cookie auth cred`), and an agent's
   md `model:` pin does NOT auto-apply to a primary `opencode2 run --agent`
   session (child/subagent sessions only). Check `opencode2 auth list`
   first. Warm up with one trivial prompt first;
   a fresh `opencode` boot can fail with a postinstall error — record
   it and switch paths instead of retrying blindly.
   Approved model errors here → FAST EXIT naming the model, never substitute.
5. Drive: `herdr agent prompt <name> "<brief>" --wait --timeout 120000`.
   The agent exits at DONE and the runner returns its pane to the shell; the
   pane stays open — no live agent afterward, but the scrollback and the
   pane itself persist for inspection/reuse. A lane that dies BEFORE done
   resumes with opencode2 `--session` in the same pane (state lives in the
   worktree).
6. Brief = the delegated subgraph (`goal/SKILL.md` §4.2): WHY, Nodes (files
   + lines, one owner), Edges (inputs consumed / outputs produced),
   Governing docs, Acceptance (frozen), Gate (verify commands), Forbidden,
   Boundary (absolute worktree path, branch, no-commit). Include the lane's
   `--agent` + `--model` (model read from the role agent's md `model:` field).
7. Return = the implemented graph (`goal/SKILL.md` §4.3), read from
   `<slug>-return.md` (the pane persists, but the file is the record):
   Implemented (files + what changed), Evidence (gate tails + log path),
   Deviations (extra/missing nodes vs the delegated subgraph), Open.
   Replies caveman-compressed, except `reviewer` (full prose).
