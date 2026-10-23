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

## Blockers
- <known blocker and resolution — or "none">

## Inputs
- <governing docs or existing plan links — omit when none>

## Memory
- `mem_save` on DONE: summary + paths to plan.md and report.md
