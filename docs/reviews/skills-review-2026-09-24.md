# Skills review — Jev scorecard (2026-09-24)

Review of the 46 committed skills in `config/skills/`. Scored with the Jev typed-decision
layer (`jev-1.13.0`), advisory only. No skill files were changed.

## Method

- **Evidence A (48h window)** — OpenCode V2 message DB (`~/.local/share/opencode/opencode.db`):
  494 sessions, 2026-09-23→24. Counted real `skill` tool invocations (including loads inside
  subagent sessions), distinct sessions, loading agents, and direct `SKILL.md` reads.
- **Evidence B (historical)** — ICM long-term memory (`context-dotfiles`, ~5000 entries over
  months): per-skill hits in stored session summaries / changelog quotes. Common-word names
  (goal, nix, reviewer) over-count; hits are relevance, not exact invocation counts.
- **Wiring** — refs in `config/opencode/agents/*.md`, `config/opencode/commands/*.md`,
  `AGENTS.md`, `docs/configuration-changelog.md`; `sources.json` kind (local-authored vs
  wired-pinned external copy).
- **Judgment** — `jev_triage`: 46 items × 3 questions (usage score 0–4, disposition,
  trigger quality). Two passes: v1 = 48h evidence (96.5K tok); v2 = 48h + historical
  (101.1K tok, 4.1 s). Merge question judged separately with `jev_ask`.

## Headline

- **No drop verdicts, in either pass.** Jev retained wired-pinned copies and niche local
  tools on structural/latent-value grounds even at near-zero usage.
- **Core ring (v2 ≥ 3.0, 11 skills)** — work-plans, steward, using-superpowers,
  git-workflow, swe, verification-before-completion, librarian, caveman, orchestration,
  reviewer, explorer. Mostly agent-loaded or routing-mandated, plus the plan pipeline.
- **One merge flag, confirmed twice:** `design-graph` (see below).
- **Historical evidence demotes the generic process-skill periphery** — superpowers
  process skills, docs-hub, design-system-patterns, using-git-worktrees.
- **Confidence caveats:** Jev action `abstain/review` on many mid-tier rows; low-usage
  ≠ dead for project-rare skills (UI, transcription, docs publishing).

## Scorecard

`v1` = 48h-only score, `v2` = +historical, `uses` = invocations/48h, `reads` = direct
SKILL.md reads, `mem` = historical memory hits, `src`: L local-authored / W wired-pinned.
`trigger`: yes / ? (uncertain); no "no" verdicts were returned.

| skill | v1 | v2 | uses | reads | mem | src | disposition | trigger |
|---|---|---|---|---|---|---|---|---|
| work-plans | 3.94 | 3.82 | 11 | 3 | 5 | L | keep-core | yes |
| steward | 3.92 | 3.81 | 95 | 6 | 8 | L | keep-core | yes |
| using-superpowers | 3.96 | 3.76 | 57 | 0 | 1 | W | keep-core | yes |
| git-workflow | 3.95 | 3.74 | 41 | 11 | 1 | L | keep-core | yes |
| swe | 3.89 | 3.71 | 30 | 0 | 4 | L | keep-core | ? |
| verification-before-completion | 3.95 | 3.65 | 62 | 4 | 0 | W | keep-core | yes |
| librarian | 3.76 | 3.38 | 95 | 7 | 0 | L | keep-core | yes |
| caveman | 3.80 | 3.27 | 16 | 0 | 5 | W | keep | ? |
| orchestration | 3.46 | 3.21 | 3 | 6 | 5 | L | keep-core | ? |
| reviewer | 3.69 | 3.16 | 18 | 0 | 3 | L | keep-core | yes |
| explorer | 3.45 | 3.07 | 13 | 6 | 2 | L | keep-core | yes |
| designer | 2.89 | 2.99 | 4 | 0 | 4 | L | keep | ? |
| architect | 3.29 | 2.97 | 2 | 0 | 5 | L | keep | ? |
| goal | 3.07 | 2.80 | 2 | 4 | 6 | L | keep-core | yes |
| caveman-commit | 3.25 | 2.78 | 19 | 2 | 1 | W | keep | yes |
| brainstorming | 3.37 | 2.77 | 2 | 0 | 3 | W | keep | ? |
| call-graph | 2.94 | 2.58 | 5 | 3 | 0 | L | keep | yes |
| design-thinking | 3.10 | 2.57 | 4 | 0 | 0 | L | keep | ? |
| finishing-a-development-branch | 2.87 | 2.43 | 4 | 0 | 1 | W | keep | ? |
| writing-plans | 2.87 | 2.23 | 1 | 0 | 1 | W | keep | ? |
| agent-browser | 2.58 | 2.17 | 3 | 1 | 0 | W | keep | ? |
| brainstorm-studio | 1.80 | 2.13 | 0 | 0 | 2 | L | keep | ? |
| dispatching-parallel-agents | 2.33 | 2.02 | 4 | 0 | 0 | W | keep | ? |
| architecture | 2.12 | 1.94 | 0 | 0 | 3 | W | keep | ? |
| system-design | 2.27 | 1.93 | 0 | 0 | 1 | W | keep | ? |
| nix | 2.53 | 1.76 | 0 | 0 | 3 | L | keep | yes |
| frontend-design | 1.83 | 1.54 | 0 | 0 | 2 | W | keep | ? |
| design-graph | 1.74 | 1.45 | 0 | 0 | 2 | L | **merge** | ? |
| systematic-debugging | 1.91 | 1.42 | 0 | 0 | 3 | W | keep | ? |
| lexa-cli | 1.49 | 1.38 | 0 | 3 | 4 | L | keep | yes |
| transcribe | 1.69 | 1.24 | 0 | 0 | 0 | L | keep | yes |
| extract-design-system | 0.75 | 1.21 | 0 | 0 | 2 | W | keep | yes |
| caveman-review | 0.81 | 1.17 | 0 | 0 | 1 | W | keep | ? |
| cavecrew | 1.27 | 1.14 | 0 | 0 | 1 | W | keep | yes |
| caveman-help | 0.95 | 1.12 | 0 | 0 | 1 | W | keep | yes |
| caveman-stats | 1.19 | 1.12 | 0 | 0 | 1 | W | keep | yes |
| caveman-compress | 1.49 | 1.11 | 0 | 0 | 1 | W | keep | yes |
| test-driven-development | 2.35 | 0.85 | 0 | 0 | 0 | W | keep | ? |
| requesting-code-review | 2.14 | 0.76 | 0 | 0 | 0 | W | keep | ? |
| using-git-worktrees | 1.82 | 0.66 | 0 | 0 | 0 | W | keep | yes |
| receiving-code-review | 1.69 | 0.63 | 0 | 0 | 0 | W | keep | yes |
| writing-skills | 2.32 | 0.58 | 0 | 0 | 0 | W | keep | yes |
| design-system-patterns | 1.37 | 0.57 | 0 | 0 | 0 | W | keep | ? |
| executing-plans | 0.64 | 0.41 | 0 | 0 | 0 | W | keep | ? |
| subagent-driven-development | 1.35 | 0.37 | 0 | 0 | 0 | W | keep | ? |
| docs-hub | 1.82 | 0.27 | 0 | 0 | 0 | L | keep | yes |

### What moved between passes

- **Demoted by historical evidence** (48h-only scores flattered them; zero memory record):
  writing-skills −1.74, test-driven-development −1.50, requesting-code-review −1.38,
  using-git-worktrees −1.16, receiving-code-review −1.06, subagent-driven-development −0.98,
  docs-hub −1.55, design-system-patterns −0.80, nix −0.77.
- **Promoted by historical evidence** (real prior work): extract-design-system +0.46,
  caveman-review +0.36, brainstorm-studio +0.33.
- **Stable core:** work-plans, steward, git-workflow, swe, using-superpowers,
  verification-before-completion, librarian, orchestration, explorer — both passes ≥3.0.
- Mechanism note (from DB system messages): the biggest counters are description-driven
  loads — `using-superpowers` ("use when starting any conversation" → 50 explore-child
  loads) and `verification-before-completion` (62 loads, mostly steward before DONE).
  These are real use, but mechanical; they are not evidence of user-facing demand.
- Post-review update (2026-09-24): `extract-design-system` removed on user decision — see docs/configuration-changelog.md.

## design-graph → design-thinking merge exploration

**Why flagged.** Jev merge verdict both passes (v1 0.82, v2 0.75); usage 0/0 in 48h,
2 memory hits both build-history docs (plugin redesign plan, changelog lane-layout), no
agent-config references, trigger quality uncertain.

**Facts.**

- `design-thinking` (41-line SKILL.md) is the r17x umbrella: router →
  `references/design-thinking.md` (120 lines) + `references/graph-protocol.md` (103).
  Its description already names `design-graph` as a sibling.
- `design-graph` (26-line SKILL.md) is a thin router → `references/design-graph.md`
  (138 lines): Surface<C,V,N> interface material.
- History: created 2026-09-05 *inside* design-thinking as a reference; promoted 2026-09-08
  to standalone for independent auto-discovery, together with `call-graph`. `call-graph`
  is used (5 invocations, 3 reads); `design-graph` never was.
- Dependents referencing it by name: `designer` (routing table, "design-graph first" rule,
  Surfaces section), `designer/evals/README.md` (assertion 8 expects the vocabulary),
  `brainstorm-studio`, `goal`, `call-graph` description, `design-thinking` sibling list,
  `CONFIGURATION.md`.

**Jev judgment** (`jev_ask`, model `jev-1.13.0`):

- `merge_choice`: **A_fold 0.62** (B keep-and-sharpen 0.22, C fold-into-designer 0.10,
  D status-quo 0.05); confidence 0.53 → action *review*, not *act*.
- `promotion_valid`: 0.26 → the 2026-09-08 promotion rationale **no longer holds**.
- `fold_breakage`: 0.69 → folding is likely implementable without lost capability
  (uncertain, leaning yes).

**Recommendation: A — fold back, with a routing audit.** Revert the 09-08 promotion for
the interface material only; keep `call-graph` standalone.

If preferred, **B** (keep standalone, sharpen description, accept rare triggers) is a
defensible low-churn alternative; no drop option exists.

**Implementation plan (if A is approved):**

1. `git mv config/skills/design-graph/references/design-graph.md
   config/skills/design-thinking/references/design-graph.md`
2. `design-thinking/SKILL.md`: add router row for interface surfaces; drop `design-graph`
   from the sibling list (keep `call-graph`); absorb UI trigger phrases into the
   description (screens/layout/empty-error states + Indonesian phrase).
3. Update dependents in the same change: `designer/SKILL.md` (2 refs + Surfaces section),
   `designer/evals/README.md` assertion 8 rationale, `brainstorm-studio/SKILL.md`,
   `goal/SKILL.md`, `call-graph` description, `CONFIGURATION.md` (wiring + inventory
   46 → 45 dirs, 3 r17x → 2), `config/skills/sources.json` (`keep` list).
4. `rm` the `design-graph` dir; run
   `bash scripts/validate-skills.sh --manifest config/skills/sources.json`
   (expect 49 skills); refresh installed copies on next `hm-switch`.
5. Dated changelog entry; commit only on request.

**Status:** applied 2026-09-24 — folded as recommended (see docs/configuration-changelog.md).

## Caveats

- Advisory judgments, not ground truth. Jev confidence is often 0.3–0.6 mid-table;
  treat rows below 2.0 as "no evidence of demand", not "dead".
- The 48h window reflects an intense skill-refactor period (goal/orchestration work),
  which inflates plan-pipeline skills and depresses others.
- 0 usage for project-scoped utilities (transcribe, docs-hub, agent-browser, lexa-cli)
  mostly means "their project context did not occur in the window".

## Repro

- DB counts: query `session_message` for `"name":"skill"` tool parts; extract
  `state.input.id`. Scripts were ephemeral (`/tmp/opencode/`).
- Jev pass 2 input state: per-skill JSON (48h usage + refs + memory hits + roster),
  one file per skill, triaged as items (paths).
- Jev calls: 2 × `jev_triage` (46 items, 3 questions) + 1 × `jev_ask` (merge, 3 questions),
  2026-09-24.
