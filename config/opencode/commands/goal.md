---
description: Run a goal to DONE — breakdown, design, protocol, track, then hand the frozen plan to the orchestration skill to execute lanes until achieved
---

Load the `goal` skill with the skill tool and follow it exactly, looping until the goal below is achieved. `goal` owns planning (intake → classify → design → protocol → track) and hands off to the `orchestration` skill at the execution gate, which runs the lanes and the verify/review/merge loop. Park-and-report on blockers per the skill; halt only on secrets exposure.

Main session orchestrates only — never call `edit`/`write` on implementation code or design docs (whatever the project declares in its `AGENTS.md`), or on skill/config files. Every mutation goes to a luvus lane (simple → one lane; complex → one per track); `subagent` calls are read-only. Direct writes are allowed only on the `status/` tracking plane.

Goal: $ARGUMENTS
