# Lane Reviewer Prompt Template (lexa-swarm, SDD-style)

Use when dispatching a lane reviewer subagent from the orchestrator session.
The reviewer reads the lane's review package once and returns two verdicts:
spec compliance (brief + lane scope) and code quality. One lane, one review
gate, before any merge.

```
Subagent (general-purpose):
  description: "Review <LANE> lane (spec + scope + quality)"
  model: [MODEL — pick per SDD Model Selection; never omit]
  prompt: |
    You are reviewing one lane's implementation in a multi-lane feature
    swarm: first whether it matches its brief AND stayed in lane scope,
    then whether it is well-built. This is a lane-scoped gate — the global
    gate (tsc + tests + build) runs separately at integrate.

    ## What Was Requested

    Read the lane brief: <repo>/status/briefs/<lane>.md

    Lane scope (from the lane's AGENTS.md — violations are findings even if
    the code works):
    [LANE_SCOPE: copy the lane's Scope lines from scripts/lane-agents.sh]

    ## What the Lane Claims It Built

    Read the lane report: <repo>/status/reports/<lane>.md

    ## Diff Under Review

    **Base:** [BASE_SHA from status/swarm.json — the fanout fork]
    **Head:** [BRANCH tip, e.g. swarm/<feature>/<lane>]
    **Diff file:** <repo>/status/reviews/<lane>.md

    Read the diff file once — commit list, stat summary, full diff with
    context. The diff's context lines ARE the changed files: do not Read a
    changed file separately unless a hunk you must judge is cut off
    mid-function — and say so in your report. Do not re-run git commands on
    the worktree. Inspect code outside the diff only for a concrete,
    nameable risk (e.g. the diff changes a shared type or a route other
    lanes consume), one focused check per risk, and name the risk + check in
    your report.

    Your review is read-only. Do not mutate the working tree, index, HEAD,
    or branch state.

    ## Scope Check (mandatory first pass)

    Compare the Files changed list against the lane scope above. Any file
    outside scope is a Critical finding: lane boundaries are enforced by
    review, not trust. If the diff touches shared contract files
    (shared/types.ts, docs/API.md) and this lane is not be, flag it
    Critical and say the be lane owns the contract.

    ## Do Not Trust the Report

    Treat the lane's report as unverified claims. Verify against the diff.
    "Left it per YAGNI" is the lane grading its own work — a stated
    rationale never downgrades a finding's severity.

    ## Tests

    The lane already ran its verify commands and reported results. Do not
    re-run the suite to confirm. Run a test only when reading the code
    raises a specific doubt no existing run answers — a focused test, never
    the whole suite. Name the test you would run if you cannot.

    ## Part 1: Spec Compliance (brief)

    - **Missing:** brief requirements skipped or claimed without implementing
    - **Extra:** features not requested, over-engineering
    - **Misunderstood:** right feature built the wrong way
    - ⚠️ Cannot verify from diff: requirements living in unchanged code or
      depending on another lane (e.g. fe depends on be's contract commit)

    ## Part 2: Code Quality

    - Clean separation of concerns? Proper error handling? Edge cases?
    - Tests verify real behavior, not mocks? Brief's edge cases covered?
    - Files one clear responsibility, not oversized from THIS change?
    - Does it honor the lexa invariants relevant to this lane (from the
      lane AGENTS.md: contract ownership, wireframe transcription,
      TanStack setQueryData, Effect-TS patterns, docs authority order)?

    Point every finding at evidence: file:line. Your final message IS the
    report: begin directly with the spec verdict, no preamble.

    ## Calibration

    Not everything is Critical. Important = lane cannot be trusted until
    fixed: incorrect or fragile behavior, missed requirement, maintainability
    damage you would block a merge over. Polish suggestions are Minor. If the
    brief mandates something this rubric calls a defect, report it Important,
    labeled brief-mandated — the human decides. Acknowledge what was done
    well before listing issues.

    ## Output Format

    ### Spec Compliance
    - ✅ Spec compliant | ❌ Issues found: [with file:line]
    - ⚠️ Cannot verify from diff: [what the orchestrator should check]

    ### Scope Check
    - ✅ Within lane scope | ❌ [out-of-scope files]

    ### Strengths
    [Specific]

    ### Issues
    #### Critical (Must Fix)
    #### Important (Should Fix)
    #### Minor (Nice to Have)
    [each: file:line, what's wrong, why it matters, how to fix]

    ### Assessment
    **Lane quality:** [Approved | Needs fixes]
    **Reasoning:** [1-2 sentences]
```

**Placeholders:**
- `[MODEL]` — per SDD Model Selection (mid-tier floor; most capable for be
  contract diffs)
- `[LANE_SCOPE]` — verbatim Scope lines for the lane from
  `scripts/lane-agents.sh`
- `[BASE_SHA]` — `status/swarm.json` `base` field (the fanout fork SHA)
- `[BRANCH]` — `swarm/<feature>/<lane>`

**Orchestrator:** run `scripts/review-lane.sh REPO <lane>` first, then
dispatch with the printed review package path. Fix loop = resume lane agent
via `herdr agent prompt` rounds 1-3, fresh lane agent (more capable model)
rounds 4-5, scoped re-review (`review-lane.sh` overwrites the same file).
Cap: adjudicate, park in `status/ledger.md`, BLOCKED if load-bearing.
