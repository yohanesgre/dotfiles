---
description: Plan a goal with design-thinking; coordinate one plan inline or supervise multiple plan harnesses through H2H
---

Load `goal` and follow its intake, design-thinking, planning and approval workflow. Planning-only requests stop before execution. One plan may hand off inline to `orchestration`; multiple concurrent plans keep this session as command center and use `h2h_control` to dispatch one separate coordinator harness per ready plan.

Each coordinator runs `/orchestrate` with native lane subagents. Do not launch a harness per lane, recursively invoke `/goal` in children, or implement several plans through this center's own mutation workers. Preserve per-plan ownership, explicit lifecycle/git approvals, external tracking and same-plan findings/replanning. Verify child reports and goal acceptance; an ACP turn finishing does not mean a plan is DONE. Unknown ownership/shutdown blocks replacement.

Goal: $ARGUMENTS
