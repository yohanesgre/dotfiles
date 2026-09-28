---
name: review-request
description: Use when verifying completed work before merge or after a major task — dispatch a reviewer subagent with a frozen review package.
---

# Requesting Code Review

Dispatch a reviewer subagent to catch issues before they cascade. The reviewer gets precisely crafted context — never your session's history.

**Core principle:** Review early, review often.

## When

**Mandatory:**
- After each task in subagent-driven development
- After completing a major feature
- Before merge to main

**Optional:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing a complex bug

## Steps

**1. Freeze the review range.** Pick the diff and record the exact base/head:

```bash
BASE_SHA=$(git rev-parse HEAD~1)   # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

When a plan file exists, generate the review package with `scripts/review-package`
so the reviewer reads one file instead of re-deriving the diff.

**2. Dispatch a reviewer subagent.** Never review the diff inline, and never hand
over your session history. Fill in the template at [code-reviewer.md](code-reviewer.md)
and dispatch it with the frozen range and package path.

**3. Act on the findings** in severity order:
- Critical — fix immediately.
- Important — fix before proceeding.
- Minor — note for later.
- Reviewer wrong — push back with technical reasoning.

## Red Flags

Never skip review because "it's simple", ignore Critical issues, proceed with
unfixed Important issues, or argue with valid technical feedback.
