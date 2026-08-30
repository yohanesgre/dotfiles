# lexa-swarm pipeline lessons — 2026-08-13 (milestones-sprints run)

Running collection of problems hit while operating the lexa-swarm pipeline.
Each entry: what happened, why it hurt, how to prevent it. Append-only.

## L1. Worktree path mismatch between scripts

**Problem:** `make-worktrees.sh` defaults `WT_BASE=$HOME` → worktrees land at
`~/lexa-<lane>`. But `wait-lane.sh` defaults `WT="${WT:-$HOME/projects/lexa-$LANE}"`
— a path that only matches the previous convention (`~/projects/lexa-*`).
`wait-lane.sh` silently watched the WRONG directory: it never saw worktree
changes, so a finished lane was only detected via the status file (and
"idle with NO new output" loops ran forever otherwise).

**Fix:** derive the worktree path from `status/swarm.json` (the manifest is the
single source of truth) instead of a hardcoded convention. Or read `WT_BASE`
from the same env the fanout used. Also: `make-worktrees.sh` should print the
resolved `WT_BASE` loudly at start.

**Status:** OPEN — needs script change + re-test.

## L2. Idle lane with stale status is indistinguishable from "done"

**Problem:** the `be` lane went idle mid-task: status file said `WORKING` with
an OLD timestamp, no report file, uncommitted migration. `wait-lane.sh` only
detects transitions when the status file CHANGED during the wait — a lane that
stalled before producing output loops "WARN: idle with NO new output" forever
(the 15s sleep × ~100 iterations before I aborted).

**Fix ideas:**
- `wait-lane.sh` should detect "status ts older than X minutes AND agent idle"
  and exit with STALLED so the orchestrator re-prompts instead of looping.
- Lane agents should heartbeat the status file on every significant action
  (AGENTS.md already says so — not followed; make the failure visible).
- A stalled `WORKING` + no report + dirty worktree should surface as a
  distinct state, not a hang.

**Status:** OPEN — script improvement (stall detection).

## L3. Backticks/parens in `herdr agent prompt` get shell-mangled

**Problem:** dispatch prompt contained backtick-quoted code snippets; zsh
executed them as command substitution, sending a garbled prompt to the lane
("no such file or directory: src/swimlanes.html" errors from MY shell, prompt
corrupted). Lane received nonsense.

**Fix (used):** write findings/prompts with code to a file
(`status/findings-<lane>.md`) and prompt the lane to READ the file. Rule:
**any prompt containing backticks, `$()`, or `>` goes in a file first.**
`herdr agent prompt` accepts plain text only — never trust it with markup.

**Status:** WORKAROUND in use; could add a `prompt-file.sh` helper.

## L4. Previous feature's worktrees/branches block a new run

**Problem:** auth-roles-teams run left worktrees + merged branches. `prune.sh`
refused to delete branches still checked out in worktrees; `git worktree
remove` refused on dirty worktrees (needed `--force`); stale `status/`
(PLAN.md, ledger, swarm.json from the old feature) confused the new run
(manifest base mismatch check in make-worktrees.sh failed the whole run).

**Fix (manual, used):** `git worktree remove --force` each lane, prune, then
`rm -rf status/` before `make-worktrees.sh`. Add a first-class
`reset-swarm.sh REPO FEATURE` that: removes all lane worktrees (force),
prunes merged branches, archives+clears `status/`, and warns on UNMERGED
lane branches (don't delete those — ask).

**Status:** OPEN — add reset script.

## L5. `review-lane.sh` produces empty packages for wf

**Problem:** the wf lane's changes live in the `wireframes/` SUBMODULE — the
parent branch has zero commits, so `review-lane.sh base..branch` produced a
0-commit, 132-byte package. The wf review had to be assembled manually from
the submodule diff (`git -C wireframes log/diff`).

**Fix:** special-case wf in `review-lane.sh`: diff the submodule commit range
(base pointer .. lane pointer) instead of the parent branch. The manifest
could record the submodule head SHA per lane.

**Status:** OPEN — script change.

## L6. Lane DONE reports arrive with UNCOMMITTED work

**Problem:** fe/docs/cli/wf reported DONE but (per the "no commits unless
asked" rule) had committed nothing; fe had 43 dirty files. The orchestrator
had to notice, verify scope, then explicitly authorize commits per lane —
extra round-trips and a verification window (a dirty worktree review would
have been impossible).

**Fix ideas:**
- Distinguish in the lane AGENTS.md: "DONE means committed (unless the
  orchestrator explicitly said don't commit)". Or:
- Orchestrator protocol: after a lane's DONE + review approval, ALWAYS send
  one "commit your work" prompt before the review gate (reviewer reads
  base..branch — needs commits).
- wf is the exception (commits inside submodule; parent pointer bump happens
  at release).

**Status:** OPEN — protocol/AGENTS.md wording change.

## L7. `herdr agent start` failed for fe on first spawn

**Problem:** spawn-layout.sh printed "WARN: agent start failed for fe —
install the integration first" even though the integration IS installed
(herdr 0.8.0, opencode named agents working for wf/be/cli/docs). A manual
retry of the same command succeeded. Transient failure or race right after
`tab create` — the pane existed but the agent never started, and nothing
notifies the orchestrator.

**Fix:** spawn-layout.sh should VERIFY after launch (`herdr agent list` shows
the lane; if absent, retry once) and exit nonzero on failure instead of a
soft WARN.

**Status:** OPEN — script change.

## L8. Old panes/tabs from previous feature must be cleaned first

**Problem:** the previous run's panes (wf/be/cli/docs/fe in tabs w6:tC/t6:tD)
had stale cwds pointing at removed worktrees (showed as "(deleted)").
Re-running spawn-layout.sh on top would have created duplicates. Had to
manually stop agents + close tabs before spawning the new layout.

**Fix:** make `spawn-layout.sh` idempotent: detect existing named lane agents
(`herdr agent list`), stop them, close their tabs, THEN create the layout.
Also add a `--recycle` flag that removes old worktrees first (ties into L4).

**Status:** OPEN — script change.

## L9. wait-lane.sh exit-0 on "idle with NO output" ambiguity

**Problem:** the script's only DONE signal is "idle + status file changed OR
worktree changed since snapshot". When the wait STARTS while the lane is
already idle-with-output, it prints "finished" immediately — but when the lane
was idle with NO new output the whole time (stalled), it loops the WARN
forever. There is no way to tell "worked and stopped" from "never started"
without looking at the worktree/status delta — the WARN text exists but the
loop never times out fast.

**Fix:** count consecutive WARNs; after N (e.g. 8 = 2 min) exit STALLED with a
message telling the orchestrator to check the lane's pane and re-prompt.
Distinct exit codes: 0 done, 1 timeout, 2 stalled.

**Status:** OPEN — script change.

## L10. Lane waits abort mid-loop leave no resume point

**Problem:** I ran three `wait-lane.sh` sequentially in one bash command with
a 300s outer timeout — the outer timeout killed the wait, leaving the session
mid-orchestration with no record of which lanes were still pending. The ledger
saved us (it's the only resume point).

**Fix:** never batch multiple blocking waits in one shell command; one
`wait-lane.sh` call per lane per message, and always append a ledger line
before waiting so a crash has a resume point.

**Status:** OPEN — orchestrator discipline (note in SKILL.md).

## L11. Stale status timestamp ≠ actual activity

**Problem:** be's status file had ts 1786604243 (contract commit time) while
the agent sat idle for minutes — "WORKING" with an old ts looked like active
work. The heartbeat contract exists but lanes don't reliably write it.

**Fix:** treat ts staleness as a FIRST-CLASS signal in wait-lane.sh (stall
detection per L2/L9) and make the AGENTS.md heartbeat instruction louder:
"status file must be rewritten within 60s of ANY tool activity".

## L12. Merge-gate GATE_CMD needs `bun run typecheck`, not bare `tsc`

**Problem:** merge-gate.sh default `GATE_CMD='tsc --noEmit && ...'` — bare `tsc` not on PATH in the shell → "GATE FAILED after merge" even though the merge itself was clean. Wasted a full gate cycle.

**Fix:** the skill's gate.sh should use `bun run typecheck` (package.json has it) and `bunx vitest run` (bare `vitest` is not a PATH binary either; `rtk vitest` wrapper garbles output). Update gate.sh + merge-gate.sh default.

## L13. wf lane's submodule commits are NOT visible in the parent repo

**Problem:** wf lane committed inside the wireframes submodule (its branch = 0 parent commits). merge-gate merges the empty branch fine, but the SUBMODULE POINTER never moves — main still points at the pre-feature submodule SHA. Also the lane's submodule commits exist only in the wf worktree (detached HEAD, never pushed — private repo). Manual recovery: `git -C wireframes fetch ~/lexa-wf/wireframes <sha>` then checkout + commit the pointer bump.

**Fix:** make the wf lane (or the orchestrator at integrate) explicitly: (1) push the submodule branch/commit to origin from the lane worktree, (2) bump the parent pointer and include it in the merge. merge-gate.sh should special-case wf: verify the submodule pointer moved and fail loudly if not.

## L14. `wait-lane.sh` WT path default — REAFFIRMED the hard way

**Problem:** this run's worktrees were at ~/lexa-* (WT_BASE=$HOME), wait-lane.sh defaulted to ~/projects/lexa-*. Every wait call needed `WT=~/lexa-<lane>` explicitly — easy to forget when switching lanes; a missed WT silently watches the wrong dir. (L1 already; hit again because the fix isn't shipped.)

**Fix:** L1's fix (derive from swarm.json) is still open — this is its second occurrence. Prioritize it.

## L15. Stale dev-server processes hold :3000 after integrate

**Problem:** after the merge, the API kept serving OLD code (kind 'milestone' schema errors) because pre-merge `server/entry.ts` processes (pids 2455, 2913482) still held :3000; the freshly-spawned dev:full couldn't bind. Smoke tests 401'd/500'd until `kill` + restart. The dev pane was spawned at layout time, long before the feature merged.

**Fix:** at integrate, explicitly restart the dev-server pane (ctrl+c + `bun run dev:full`) and verify `curl /api/health` + a feature endpoint BEFORE declaring smoke green. Check for orphan `bun server/entry.ts` pids and kill them.

## L16. Browser-less smoke tests must know the auth scheme

**Problem:** the API smoke tests initially 401'd because I used the `x-lxk-api-key` header convention from AGENTS.md; the actual API (post auth-rework) uses `Authorization: Bearer <key>`. `app/lib/api.ts` fetches with Bearer; `server/entry.ts` injects the key meta. curl smoke: `-H "Authorization: Bearer $LXK_API_KEY"`.

**Fix:** document the smoke-test curl pattern in the skill (Bearer header, and `?includeArchived=true` for board, and that /api/auth/* is exempt).

## L17. SSR smoke needs a browser session; unauthenticated curl = redirect test

**Problem:** `curl :5173/nimbus/board` (no cookie) → 500 "reading 'session'" — this was a REAL pre-existing bug (auth fetchers cast `null` JSON body to SessionResponse; __root reads res.session). It surfaced only because smoke testing hit the unauthenticated SSR path. Browser sessions (with cookie) masked it.

**Fix (shipped):** null-guards in auth-session.server.ts + auth.ts (commit 4146bdc). Lesson: smoke BOTH authenticated and unauthenticated SSR paths. Also: any 500 with a JS error page must be investigated, never assumed pre-existing.

## L18. Review round discipline — plan-mandated findings still get fixed

**Problem:** be's 2 Important findings were "plan-mandated" (the plan's own sample code had the same gaps). Temptation: park them. Reality: they were real bugs (partial PATCH validation bypass; sprintCount=0 clobbering FE cache). Ruled: fix both. Lesson: "plan-mandated" labels the blame, not the severity — the human (orchestrator) should default to fixing genuine bugs even when the plan caused them.
