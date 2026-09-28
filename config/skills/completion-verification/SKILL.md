---
name: completion-verification
description: Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always
---

# Completion Verification

**Core principle:** Evidence before assertions, always.

## The Gate

Before claiming anything about work state, run the gate:

1. **Identify** — what command proves the claim?
2. **Run** — execute the full command fresh; no cached or partial runs.
3. **Read** — read full output, check exit code, count failures.
4. **Decide** — does output confirm the claim? Not confirmed: state actual status with evidence. Confirmed: state the claim *with* evidence.
5. **Then** — only after steps 1-4, make the claim.

Skipping a step means guessing, not verifying.

## Applies To

- Any success/completion/passing claim, before commit or PR.
- Test pass, lint clean, build succeeds, bug fixed, task done, agent reports done.
- Exact wording, paraphrases, and implications of success alike.

## Never Sufficient

Previous run, "should pass", logs look good, code changed, agent success report — evidence is the command's fresh output, not inference.
