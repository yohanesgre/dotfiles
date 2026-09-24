# Jev judgment layer (advisory)

`jev-mcp` is the typed decision layer: `tools["jev-mcp"].*` (`jev_check`,
`jev_ask`, `jev_triage`, `jev_score`, `jev_classify`, `jev_models`) called
through `execute` (Code Mode — MCP namespace, not shell). When reachable, the
orchestrator uses it as a cheap, typed pre-filter at three points. It is
ADVISORY: it never replaces the human execution gate, the `reviewer`
subagent, CI, or the evidence rule — a jev verdict is never a completion
signal. Direct subagent calls are permission-gated by the nested `jev-mcp_*`
allow (`architect`/`researcher`/`reviewer`/`swe` since 2026-09-24); the
primary session is allowed.

- **Gate pre-check.** `jev_check` on the frozen plan (acceptance list +
  wave graph + route + lane models): "internally consistent, correctly
  scoped, ready to execute?" A `no`/`uncertain` is surfaced in the gate
  presentation; the human still decides.
- **Review pre-filter (Phase 5).** `jev_triage` over each lane's
  `git diff` — pass the diff as a `path` item so its contents are read
  server-side and never enter the orchestrator context — with checks:
  `scope` (diff ⊆ the lane's assigned files), `acceptance` (frozen criteria
  appear met), `secrets` (no credential added), `offscript` (no extra or
  missing nodes vs the delegated subgraph). A failing check sends the lane
  back to fix BEFORE the `reviewer` subagent runs; a passing check does not
  skip the reviewer.
- **Pre-merge.** `jev_check` on the PR (diff + gate tails + deviations):
  "safe to auto-merge on green CI?" Advisory; policy and CI still decide.

Failure mode: jev unreachable, errors, or `abstain` → skip it and fall back
to the existing reviewer path (never a blocker). Never let jev output
substitute for pasted gate evidence.

`jev_triage` reads file `path` items below the server's allowed root
(default: its working directory) without their contents entering the
orchestrator's context — use it for diffs and lane artifacts. Credential
files are refused by the server.

The tracking-plane judgments — plan-readiness at open, plan-closure before
DONE — live in the `work-plans` skill (§ Jev judgment).
