---
description: Orchestrate a frozen plan into isolated native subagent lanes — dispatch, verify, close out, review, merge, loop until done
---

Load the `orchestration` skill with the skill tool and follow it exactly. Use this when a plan/wave graph already exists (e.g. `$PLAN_DIR/plan.md` in the external work-plans root, resolved with `plan-root.sh`) and only execution remains: it runs the execution gate, then isolates, dispatches native lane workers, verifies, closes out (PR), reviews, and merges each lane, looping until the plan is DONE. One coordinator/harness instance owns one plan.

Main session orchestrates only — never call `edit`/`write` on implementation code or design docs (whatever the project declares in its `AGENTS.md`), or on skill/config files. Every mutation goes to a native lane worker of THIS harness (simple → one lane; complex → one per track); read-only work goes to native read-only subagents. Do not start a second harness instance per lane, and do not absorb a second plan — it needs its own coordinator. Direct writes are allowed only on the external tracking plane (`$PLAN_ROOT`/`$PLAN_DIR`, resolved with `plan-root.sh`; shared `TIMELINE.md` only via `plan-event.sh`).

Plan / work: $ARGUMENTS
