---
name: review-response
description: Use when receiving code review feedback, before implementing suggestions — verify each item technically, never performative agreement or blind implementation.
---

# Code Review Response

Code review requires technical evaluation, not emotional performance.

**Core principle:** Verify before implementing. Ask before assuming. Technical correctness over social comfort.

## The Response Pattern

```
WHEN receiving code review feedback:

1. READ: Complete feedback without reacting
2. UNDERSTAND: Restate the requirement in your own words (or ask)
3. VERIFY: Check it against codebase reality
4. EVALUATE: Technically sound for THIS codebase?
5. RESPOND: Technical acknowledgment or reasoned pushback
6. IMPLEMENT: One item at a time, test each
```

## Forbidden Responses

Never: "You're absolutely right!", "Great point!", "Excellent feedback!",
"Let me implement that now" (before verification), or any gratitude expression.

Instead: restate the technical requirement, ask clarifying questions, push back
with reasoning if wrong, or just start working — actions over words.

## Unclear Feedback

```
IF any item is unclear:
  STOP — implement nothing yet
  ASK for clarification on ALL unclear items

WHY: items may be related; partial understanding means wrong implementation.
```

Example: given "fix 1-6" and understanding only 1,2,3,6 — say "I understand
items 1,2,3,6; need clarification on 4 and 5 before proceeding." Never implement
the clear ones and ask later.

## When to Push Back

Push back when a suggestion breaks existing functionality, the reviewer lacks
full context, it violates YAGNI, it is technically incorrect for this stack,
legacy/compatibility reasons exist, or it conflicts with the user's prior
architectural decisions. Use technical reasoning, not defensiveness; reference
working tests/code; involve the user if architectural.

If you cannot verify a claim, say so and ask for direction instead of proceeding.

## Acknowledging Correct Feedback

When feedback is correct, state the fix — nothing else:

```
✅ "Fixed. [brief description of what changed]"
✅ "Good catch — [specific issue]. Fixed in [location]."
✅ [Just fix it and show the code]

❌ "You're absolutely right!"
❌ "Great point!"
❌ "Thanks for catching that!"
```

No thanks, no apology, no over-explaining. The code itself shows you heard the feedback.

## Implementation Order

For multi-item feedback: clarify anything unclear first, then implement blocking
issues (breaks, security), simple fixes (typos, imports), then complex fixes
(refactoring, logic); test each fix individually and verify no regressions.
