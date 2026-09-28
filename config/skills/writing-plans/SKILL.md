---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code. Authors the implementation-plan document (authoring plane); runtime tracking is the separate `work-plans` skill.
---

# Writing Plans

## Overview

Write an implementation plan an engineer with zero context for this codebase can execute. Document which files to touch per task, the code, the tests, the docs to check, and how to verify each step. Bite-sized tasks. DRY. YAGNI. Frequent commits.

Assume a skilled developer who knows almost nothing about this toolset or problem domain.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Save plans to:** `.agents/plans/YYYY-MM-DD-<feature-name>.md`
- User preferences for plan location override this default.
- **Local artifact:** never commit or push the plan. Gitignore the plan directory if it is tracked.

## Scope (authoring plane)

This skill **authors** the plan document — the what and how (files, code, tests, verify commands). It is the *authoring plane*, not the tracking plane:

- It never creates or edits `status/` or `status/TIMELINE.md` — runtime tracking is the `work-plans` skill.
- Under `/goal` (or the Orchestrated handoff), `status/<plan>/plan.md` stays the single plan of record; **this document is an input artifact** — its files/tasks/tests are folded into that plan and linked from it, never duplicated.
- The Orchestrated handoff loads `orchestration`, which requires `work-plans` (tracking); the Inline handoff needs neither.

## Scope Check

If the spec covers multiple independent subsystems, it should have been decomposed during the design stage. If it was not, suggest separate plans — one per subsystem. Each plan must produce working, testable software on its own.

## File Structure

Before defining tasks, map the files to create or modify and each one's responsibility. Design units with clear boundaries and well-defined interfaces; prefer smaller, focused files. Follow existing patterns; include a split only when a file you touch has grown unwieldy. This structure informs the task decomposition.

## Task Right-Sizing

A task is the smallest unit that carries its own test cycle and is worth a fresh reviewer's gate. Fold setup, config, scaffolding, and documentation into the task whose deliverable needs them; split only where a reviewer could reject one task while approving its neighbor. Each task ends with an independently testable deliverable.

## Bite-Sized Task Granularity

Each step is one action (2-5 minutes): write the failing test; run it to confirm it fails; write the minimal implementation; run the tests to confirm they pass; commit.

## Plan Document Header

Every plan MUST start with this header:

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the `orchestration` skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

## Global Constraints

[Project-wide requirements — version floors, dependency limits, naming and copy rules, platform requirements — one line each, exact values copied verbatim from the spec. Every task inherits this section.]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

**Interfaces:**
- Consumes: [what this task uses from earlier tasks — exact signatures]
- Produces: [what later tasks rely on — exact function names, parameter and return types]

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" without actual test code
- "Similar to Task N" (repeat the code — tasks may be read out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Self-Review

After the complete plan, check it against the spec with fresh eyes — inline, not a subagent dispatch:

1. **Spec coverage:** point to a task for each spec section or requirement; list gaps.
2. **Placeholder scan:** search for the "No Placeholders" patterns above; fix them.
3. **Type consistency:** do names, signatures, and property names in later tasks match earlier tasks?

Fix issues inline, then move on. Add a task for any uncovered requirement. For an optional fresh-eyes subagent pass, use `plan-document-reviewer-prompt.md`.

## Execution Handoff

After saving the plan, offer the execution choice:

**"Plan complete and saved to `.agents/plans/<filename>.md`. Two execution options:**

**1. Orchestrated (recommended)** — hand the plan to the `orchestration` skill: dispatch tasks into isolated lanes, run the execution gate, verify, and review per lane. Tracking opens via the `work-plans` skill (required by `orchestration`) — this plan doc becomes its linked input, not a second plan of record.
**2. Inline Execution** — execute the plan in this session in batches with checkpoints.

**Which approach?"**

- **If Orchestrated:** REQUIRED SUB-SKILL: Use the `orchestration` skill.
- **If Inline:** execute in this session in batches with checkpoints for review.
