# Human-Friendly Reports — Writing + Design

Read this **only when the user explicitly asks** for a human-friendly / visual /
HTML report. The default review output is text, and automation (goal lanes,
subagent reviews) must stay fast and cheap — for those, do not load this file and
do not render HTML.

When HTML is requested, the template in `assets/review-report.html` only supplies
the shell; this file owns the words and the structure. The hard part is the
writing. Design without rewriting still fails.

## The goal

A busy human opens the report and, within ~10 seconds, knows three things:

1. **Can I merge?** (verdict)
2. **How bad is it?** (counts)
3. **What do I do first?** (top action)

Everything else is support. If the top screen doesn't answer those, the report failed.

## Part 1 — Writing rules

These apply to the text report too, not just HTML.

1. **Verdict first, in plain words.** `No blockers.` — not `The review concluded that no blocking issues were identified.` Verdicts are one short line plus one sentence of why.
2. **Lead every item with the action.** Fix lines start with a verb: `Delete…`, `Replace…`, `Guard…`, `Move…`. Never `It would be good if…` or `Consideration should be given to…`.
3. **One idea per sentence. ≤ 25 words. Paragraphs ≤ 3 lines.** If a paragraph has two "and"s and a parenthetical, split it.
4. **Bullets for anything enumerable.** Steps, affected files, options, consequences. Prose is only for the *why* — and the why gets 1–2 sentences.
5. **Card shape: Problem → Fix → Why.**
   - Problem: one sentence, what's wrong.
   - Fix: 2–3 verb-first bullets.
   - Why: short paragraph (impact, what breaks, who is affected). No history lesson.
6. **Cut filler and hedging.** Ban: "it is worth noting", "in order to", "may potentially", "the fact that", "as previously mentioned", "it should be noted", "basically", "simply", "just". Say the thing.
7. **Active voice, name the actor.** `the sync rewrites the file` — not `the file gets rewritten`.
8. **Concrete over abstract.** Name the file, the key, the command, the exit code. `hidden: true at agent-browser/SKILL.md:5` beats `a non-standard frontmatter attribute`.
9. **Impact before mechanism.** State what breaks, then how it works. Readers decide on impact; mechanism is for the fix.
10. **Define or drop jargon.** Expand internal shorthand on first use. If a term isn't needed to decide, cut it.
11. **Rewrite, don't paste.** Never paste the raw audit prose into a card. The report is a briefing for someone who hasn't read the audit; long sentences are a bug.
12. **Keep code and paths verbatim**, but keep the surrounding prose short. A code snippet must earn its place (≤ 10 lines, proves the point).
13. **Numbers are digits; lists are lists.** No prose enumerations like "one, two, and three things".
14. **No justification.** Ragged right; justified text makes narrow cards uneven.
15. **One severity vocabulary, used consistently.** SEV = must fix, MED = should fix, NIT = optional. Calibrate by impact, not category.

### Worked example (from a real report)

Dense audit prose (do NOT ship):

> It is the only committed skill carrying this key, and the repo's own validator flags it (unknown top-level keys: hidden). opencode v2.0.1 ignores unknown frontmatter keys — the skill still appears in this session's list — but the whole design is deliberately harness-agnostic (npx skills -a universal into the shared ~/.agents/skills root), and the skill is declared mandatory in config/opencode/AGENTS.md:153. Any consumer that does honor the key would hide a skill agents are told to load. Upstream vercel-labs/agent-browser ships the same key, so a --wired refresh would quietly re-add it.

Rewritten card:

> **Problem** `agent-browser` carries a stray `hidden: true` — not a real Agent Skills key, and the only skill with it.
>
> **Fix**
> - Delete the line at `config/skills/agent-browser/SKILL.md:5`.
> - Strip it after `skills-sync.sh --wired` so upstream refreshes don't re-add it.
> - To actually hide a skill, use an opencode deny permission, not frontmatter.
>
> **Why** `AGENTS.md:153` tells agents to load this skill. opencode ignores the key today; any consumer that honors it would hide a mandated skill. Upstream ships the same key, so refreshes would quietly restore it.

Same facts. A third of the words. Action visible in the first line.

## Part 2 — Page structure

Full recipe, top to bottom:

1. **Header** — title, repo/range/date, verdict badge (top right).
2. **Verdict line** — bold opener (`No blockers.` / `3 must-fix.`) + one sentence of why + the counts row.
3. **Top 3 fixes** — the only findings most readers act on. Cards, ranked by severity.
4. **How it flows** (optional diagram) — only when the review has a pipeline/graph insight a table can't carry.
5. **The rest** — table or compact cards, one row/card per remaining finding.
6. **Claims verified** (optional) — when the report corrects/confirms earlier claims.
7. **Strengths** — brief; what to keep.
8. **Summary** — 2–3 sentences.

For small reviews (< 5 findings) skip sections 3–6: verdict → issues → strengths → summary. Do not inflate a clean review into a page.

## Part 3 — Card anatomy

```
[SEV] file:line [CONFIRMED|SUSPECTED]
Problem: one sentence.
Fix:
  - verb-first action
  - verb-first action
Why: 1-2 sentences on impact.
[optional snippet ≤10 lines]
```

- Severity badge + location + evidence chip on one line.
- `Problem` is a sentence, not a paragraph.
- `Fix` is bullets. If the fix is one step, still make it a bullet.
- `Why` is where nuance lives — and it is still short.
- SUSPECTED must say what would confirm it.

## Part 4 — Design rules

Use the bundled template; extend only with inline CSS.

- **Color maps to severity**: red = SEV, amber = MED, blue/teal = NIT, green = pass/strength. Never color alone — the badge text carries the level.
- **One accent per meaning.** Don't reuse amber for both MED and decoration.
- **Diagram**: max 3 zones, ≤ 6 words per node, and hard font floors — box titles 18px, sub-labels ≥ 14.5px, arrow labels ≥ 14px, mono annotations ≥ 12.5px (values are relative to a 760-wide viewBox scaled to ~880px). No path dumps inside boxes; if a label needs a paragraph it belongs in a caption. Verify legibility at native size, never from a compressed full-page screenshot — scaling makes good diagrams look unreadable.
- **The rest**: rows need visible separation (card border, alternating background, or rules). Never stack bold-heading + paragraph blocks with no boundary.
- **Tables**: short cells — **no cell over two lines**. If the evidence needs a paragraph, it belongs in a card, not a cell. Long "claims verified" tables are the usual offender: keep claim, status, and a one-line reason.
- **Cards in ranked sections** carry two badges that serve different jobs: a position counter (`fix 2 of 3`) and an evidence chip (`CONFIRMED`/`SUSPECTED`). Keep both.
- **Metadata must pin the review**: repo, range/commit, and date. Stats are useful context, not a substitute for traceability.
- **Numbers row** (`0 SEV · 4 MED · 4 NIT`) with an inline legend belongs directly under the verdict.
- **Dark theme with light-mode support**; body text 15px/1.55 minimum; monospace only for code/paths.
- **Self-contained**: inline CSS, no external scripts/fonts/CDN. Escape code as HTML entities.

## Part 5 — Anti-patterns

- Wall of prose in a card (the #1 failure — rewrite, don't paste).
- Jargon soup: harness, boundary, channel, gate, layer used without plain-language grounding.
- Severity without impact (`MED` and nothing about what breaks).
- `file:line` with no plain-language "what is there".
- Diagram as a path dump; labels unreadable at 100%.
- Stacked identical-looking finding blocks with no separation.
- Justified paragraph text.
- Decorative noise: emoji, badges for their own sake, multiple competing accent colors.
- Over-reporting style preferences as findings; NITs should already be short.

## Part 6 — Pre-flight (the 10-second test)

Before writing the file, check:

- [ ] Top screen answers: merge? how bad? first action?
- [ ] Verdict is one plain line, before any detail.
- [ ] Every fix bullet starts with a verb.
- [ ] No paragraph exceeds 3 lines; no sentence exceeds ~25 words.
- [ ] Every `file:line` has a plain-language "what" next to it.
- [ ] The diagram (if present) is readable at 100% zoom.
- [ ] No raw audit prose pasted anywhere.
- [ ] No table cell needs a paragraph (≤ 2 lines per cell).
- [ ] Metadata carries repo, range/commit, and date.
- [ ] Ranked cards show a position counter and an evidence chip.
- [ ] Strengths and summary are brief.
- [ ] Text report: same rules — one line per issue, verb-first fix.

If any box is unchecked, rewrite before rendering. A beautiful page of dense prose is still unreadable.
