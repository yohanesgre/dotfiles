# Run diagnosis (improve/fix loop)

Trigger: a plan FAILED; a lane return `rc≠0`; repeated failures or rising
durations in the report; the user asks why orchestration is slow/broken.

1. **Read the report.** `scripts/run-report.sh` (all repos) or
   `ORCH_REPO=<repo> run-report.sh`. It is the only view of the central log
   (`$HOME/.local/state/orchestration/runs.jsonl`).
2. **Classify the signal → next evidence.**
   - lane `rc≠0` → the lane's return file (`<worktree>/../<slug>-return.md`)
     + its captured log (`<slug>-return.md.tmp`). Classify: brief ambiguity ·
     missing/wrong gate · environment (binary/auth) · genuine task failure.
     Only the first two are skill problems; environment and a real task
     failure are not.
   - plan `verdict != DONE` → `status/<plan>/report.md` + `status/TIMELINE.md`
     + the FIRST breaking wave's return files.
   - repeated failures (same repo/plan/lane) → the brief or gate is
     under-specified.
   - `iter>1` → rework churn; inspect what changed per iteration.
   - stable slowest lanes → brief too broad, or cap/serialization (check the
     `dur` split in the lane log).
3. **Find the owning text; edit ONLY there.** Single-writer discipline —
   never restate a rule in two files.
   - routing/caps → `SKILL.md` § Routing + `references/lane-dispatch.md`
   - brief fields/runner → `SKILL.md` §4.2 + `references/cli-reference.md`
   - close-out/panes → `references/lane-dispatch.md` step 8 + `SKILL.md`
     § Phase 5 (plan close-out)
   - logging/report → `references/cli-reference.md` § Run log
4. **Smallest evidence-backed change.** `SKILL.md` ≤500 lines ·
   `bash scripts/validate-skills.sh` rc 0 · no speculative rewrites ·
   advisory layers stay advisory.
5. **Re-measure** with the SAME query on a comparable workload; change one
   metric at a time.
6. **Record the fix** in the log:
   `runlog.sh fix plan=<plan> symptom=<signal> change=<file:what>
   before=<metric> after=<metric>` — the report's "Recent fixes" section then
   shows history; a skill-wide change also gets a
   `docs/configuration-changelog.md` entry.
7. **Escalate rather than guess**: an unmappable signal → write the diagnosis
   into the plan's `TIMELINE.md`/`report.md` and hand it to the user.
