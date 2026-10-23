# Plan: <name>
created: YYYY-MM-DD
source: <linked input plan or spec — omit when none>
worktree: <absolute path; intended until execution starts>
branch: <plan branch>
base: <project base ref>

## X (problem)
1–3 sentences: what + why. No background essay — link artifacts instead.

## Scope
- In: ...
- Out (explicit non-scope): ...

## Acceptance
- <criterion> — verify: <runnable command>

Every criterion must hold at close; unmet acceptance becomes findings and a
replan, never DONE.

## Graph A (implementation happy path)
Draw the actual call/data/content flow using `design-thinking`, not worker lanes.
For interface work, include Surface<C,V,N>: content flow, void states, and needs.

## E (break points)
| Node | Break | Treatment |
|---|---|---|
| <implementation node> | <failure or void state> | <handling> |

## R (dependencies)
- <what each implementation node needs: exact files, interfaces, services, approvals>

## Steps
Group steps into dependency-ordered waves; use one wave when no split is needed.

### W1: <deliverable>
Depends on: none
Completion check: <runnable command and expected result before dependent waves start>

- [ ] <implementation step>
  - Files: <exact paths>
  - Change: <concrete implementation>
  - Verify: <runnable command and expected result>

## Findings
Append one row per failed check, review, CI run, or smoke scenario. Fix steps
stay in this plan (never a new folder); resolve the row with evidence.

| id | source | evidence | affected lanes/files | fix steps | depends on | verify | resolution |
|---|---|---|---|---|---|---|---|
| F1 | <check/review/CI/smoke> | <command + short output> | <lane or paths> | <ordered steps> | <finding/step> | <runnable command> | <evidence + date> |

## Blockers
- <known blocker and resolution — or "none">

## Inputs
- <governing docs or existing plan links — omit when none>

## Memory
- `mem_save` on DONE: summary + resolved paths to `$PLAN_DIR/plan.md` and
  `$PLAN_DIR/report.md`
