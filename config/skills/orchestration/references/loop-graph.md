# Loop graph (execution)

Loaded from `SKILL.md` before presenting the execution gate or replanning.
Example lanes are illustrative; split only independent tracks.

```
              ┌──────── findings → plan/replan (re-approve scope) ──────┐
              ▲                          ▲                             │
              │ red check                │ red review / CI             │
              │                          │                             │
GATE → isolate → WAVE W1 ─┬─ DB lane      (schema + migration)         │
                          ├─ backend lane (API + service)              │
                          └─ UI lane      (view + interaction)         │
                                    │                                  │
                                    ▼                                  │
                        per-lane checks ─green─► review ∥ CI per lane   │
                                                    │ green            │
                                                    ▼                  │
                                                 merge PR ─► next wave │
                                    frozen acceptance met → DONE        │
                                    frozen acceptance unmet ────────────┘
```

## Happy path (execution graph)

GATE → isolate → wave{lanes} → verify → per-lane close(PR)
     → review-wave{reviewer_i ∥ CI} → merge(CI ∧ review) → loop: next wave | DONE

Lane node lifecycle (native worker of this harness instance):
dispatch native worker → work in its assigned worktree/branch → structured
result → coordinator persists + compares → close-out (commit/push/PR)
     → review ∥ CI → merge → DONE/FAILED close-out (remove merged worktrees)

## E — break points (coordinator failures, not worker failures)

Wrong context · missing input (invisible edge) · misinterpretation ·
role/model or native-capability gap · secrets · no progress ·
worker dead before completion · reviewer fail/timeout · reviewer ↔ lane
drift · jev unavailable/abstain · second plan offered mid-loop (needs its own
harness instance). Detailed handling: `SKILL.md` § Break points.

## R — every worker prompt carries

Subgraph (nodes+edges) · WHY · governing docs · acceptance · gate · forbidden
· boundary (worktree/branch, no tracking writes) · structured result contract.

## Boundary

Brief = delegated subgraph IN → result = implemented graph OUT. The native
completion is the runtime signal; its lane-attempt section in `plan.md` is
the recovery truth. Verify by comparing the implemented graph against the
delegated subgraph: an extra or missing node is a deviation.

## Failure returns

Any red per-lane check, reviewer verdict, or CI run is a finding in the same
plan (`$PLAN_DIR/plan.md` findings table) and returns to plan/replan. Fixes
that change scope, contracts, or authorization need explicit re-approval.
Replanning never resets the iteration/no-progress counters, and final unmet
acceptance replans rather than reporting DONE.
