---
name: skill-first
description: Use when starting any task or conversation — before answering, exploring files, or acting, load and follow the matching skill.
---

# Skill First

**The rule:** before any response or action — including clarifying questions, exploring files, or checking git — find and load the skill that matches the task. If a skill may apply, invoke it. If it turns out wrong for the situation, you may drop it.

If a skill has a checklist, create a todo per item.

<SUBAGENT-STOP>
Dispatched as a subagent to execute a specific task? This routing does not apply — your dispatching prompt governs. Load only the skill(s) it names.
</SUBAGENT-STOP>

## Priority

Process skills come first — they set the approach. Domain/implementation skills then carry it out.

- "Let's build X" → a brainstorming/design process skill first, then implementation skills.
- "Fix this bug" → a systematic-debugging process skill first, then domain skills.
- UI work → the process skill first, then the design/implementation skill.

When several skills apply, load the process one before the domain one.

## Red Flags

These thoughts mean stop:

- "It's just a simple question" — questions are tasks; check.
- "I need context first" — the skill check comes before clarifying questions.
- "Let me explore the codebase first" — skills tell you how to explore.
- "This doesn't need a formal skill" — if one exists, use it.
- "I remember this skill" — skills evolve; read the current version.
- "The skill is overkill" — check before deciding.

## User Overrides

User instructions (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, direct requests) take precedence over skills, which in turn override default behavior. Skip a skill workflow only when the user has explicitly told you to.
