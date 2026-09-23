---
description: Orchestrate a frozen plan into isolated luvus lanes — dispatch, verify, review, merge, loop until done
---

Load the `orchestration` skill with the skill tool and follow it exactly. Use this when a plan/wave graph already exists (e.g. a `status/<plan>/plan.md`) and only execution remains: it runs the execution gate, then isolates, dispatches, verifies, reviews, closes out, and merges each lane, looping until the plan is DONE.

Main session orchestrates only — never call `edit`/`write` on implementation code or design docs (whatever the project declares in its `AGENTS.md`), or on skill/config files. Every mutation goes to a luvus lane (simple → one lane; complex → one per track); `subagent` calls are read-only. Direct writes are allowed only on the `status/` tracking plane.

Plan / work: $ARGUMENTS
