# OpenCode Configuration

> 2026-09-12 — `brainstorm-studio` spec review gate now offers an explicit "just approve" path: at the user review gate the user picks one of three — **just approve** (spec is final; stop, no plan or implementation), **approve + plan** (invoke writing-plans), or **changes** (revise + re-run self-review). Replaces the old two-step "review spec" then separate "want a plan?" prompt. Process-flow graph collapses the `User wants a plan?` diamond into labeled edges from `User reviews spec?`; checklist item 8/9 and the Implementation section rewritten; `spec-document-reviewer-prompt.md` purpose says "ready to finalize or hand to planning". Files: `config/skills/brainstorm-studio/{SKILL.md,spec-document-reviewer-prompt.md}`.

> 2026-09-12 — `goal` lane panes are now persistent + visible (user request): a lane runs foreground in its own herdr pane so progress is watchable live — never detached or backgrounded — and the pane is NOT closed at DONE; the runner returns it to its shell so scrollback stays for inspection and the pane is reusable (same-pane follow-up, or `opencode2 --session` resume of a lane that died before done). Completion is still the durable `<slug>-return.md` file-sentinel (`lane-wait.ts` behavior unchanged), not scrollback. Updated `config/skills/goal/SKILL.md` (graph lane lifecycle, delegation bullets, layout reflow line, §4.2 dispatch, §4.3 return + lane lifecycle, lane-dead break point, graph Boundary) and `config/skills/goal/references/lane-dispatch.md` (steps 3/4/5/7) + `config/skills/goal/scripts/lane-wait.ts` docstring. Read-only nodes unchanged: `architect`/`researcher` stay inline `subagent`, `reviewer` stays async `subagent`.

> 2026-09-12 — `brainstorm-studio`/`brainstorming`/`writing-plans`: the writing-plans handoff is now optional — the approved spec is a valid terminal state. Flow gains a "User wants a plan?" decision before invoking writing-plans; checklist/implementation sections ask first instead of mandating it. Specs and plans are local-only artifacts: never committed or pushed by any skill, left unstaged for the user and gitignored (studio dir fully ignored; spec/plan dirs gitignored if tracked). `architect` routes to writing-plans only when a plan is requested. Files: `config/skills/{brainstorm-studio,brainstorming,writing-plans,architect}`.

> 2026-09-12 — researcher-first delegation rule in `config/opencode/AGENTS.md` (design-thinking graph-protocol). Applied the graph-protocol to the delegation policy itself: node = build/primary session, A = delegate(`researcher`) for exploration/research, E = primary hand-explores instead of delegating (the break being closed) + MCP-absent grep fallback + web-down fetch chain, R = subgraph (project/exact question/known qnames/evidence contract/WHY) in every researcher prompt, boundary = prompt subgraph in / findings graph out. Tool Selection now states **delegate to `researcher` by default** for multi-file exploration and all web research; inline only cheap single-file lookups. Added codebase-exploration and web-research prompt contracts (evidence: `path:line`+snippet; versioned sources; never invent APIs); parallel research → background `task()` to `researcher`. Agent Selection table now marks researcher "default — always delegate" for API/library research and codebase exploration. Takes effect at next hm-switch (AGENTS.md is a nix store symlink).

> 2026-09-12 — `goal` lane layout redesigned with design-graph (variant C, master + grid): the orchestrator keeps a fixed left master column (full height, ~34%), lanes tile a balanced grid to the right instead of repeated `--direction right` splits into skinny columns. New `config/skills/goal/scripts/lane-layout.ts` (`--anchor <pane> --lanes '<json>' [--master-ratio --min-w --min-h --dry-run]`) computes columns/rows (target tile aspect ~2:1, min 60x16 cells), splits the grid deterministically (verified herdr `--ratio` semantics: original pane keeps r, new pane gets 1−r), sets each pane cwd = its worktree, and overflows N beyond one tab's capacity to extra lane-only tabs. Wired into `references/lane-dispatch.md` step 3 (layout once per wave, after all worktrees) + `SKILL.md` §4.2. Tested live in a scratch tab: N=1 (master+lane), N=2 (cwd map /tmp + /home), N=3 ([2,1] L-grid, master 78), N=9 (overflow → 8-lane tab + 1-lane tab).
> 2026-09-12 — `goal` skill updated graph-first (design-thinking) to match two runtime changes: (1) herdr lane panes are now short-lived — the runner writes the lane report/return atomically to `<slug>-return.md` (temp + `mv`) as the LAST step, then `herdr pane close "$HERDR_PANE_ID"`; pane scrollback is gone at DONE, so the return file is the record. `scripts/lane-wait.ts` rewritten from `herdr pane wait-output` to a file-sentinel watch (`<return-file>`, 200ms bounded poll + Effect timeout, exit 0/1/2), and `lane-dispatch.md` step 4/5/7 + SKILL §4.2/§4.3 updated (dead-before-done lane still resumes via opencode2 `--session`). (2) `reviewer` subagents may now fan out background/async: the former "single foreground; background/parallel fan-out banned" rule is lifted for `reviewer` only (one per lane, read-only → collision-free, stable reviewer↔lane map, findings return to own lane). Phase 5 review is now an async per-lane wave; close-out is per-lane (a lane commits/pushes/PRs as soon as its own reviewer is green — lanes are edge-independent), `report.md`/DONE stay wave-level. New break points: lane closed before return persisted (WAIT + re-dispatch, never read scrollback); reviewer timeout/failure ≠ green.
> 2026-09-11 — exported global skills: `goal` (goal loop), `work-plans` (status/ tracking; plan-check root via `git rev-parse`), `git-workflow` (generic git discipline). Lexa keeps a project-local `git-workflow` override (git-only, self-contained). OpenCode `commands/` is now nix-managed from `config/opencode/commands/` (`/goal`).
> 2026-09-11 — researcher graph-first fix (design-thinking): drew the routing graph, closed its broken edges. `researcher` gained codebase-memory read tools (11: search_graph/trace_path/get_code_snippet/query_graph/get_architecture/search_code/get_graph_schema/list_projects/index_status/detect_changes/check_index_coverage) — the `explorer` skill referenced graph tools the permission envelope denied; added a `call-graph` route for trace/how-it-works questions (was funneled into pattern search). `explorer` rewritten as the locate subgraph: trigger-rich description, graph-first structural routing with grep for literals, fallback when MCP absent/index stale/denied, evidence contract (`path:line` + quoted snippet), explicit zero-hit reporting ("not found in <scope>" + searches run), scope-bounding (skip node_modules/dist/build/.git/generated), parallel searches, cap + truncation note. `librarian` rewritten as the external subgraph: version discipline (read manifest/lockfile first, target the pinned version, state mismatch), source chain (versioned official docs → repo source@tag incl. tests → releases/issues → community), fetch fallback chain (webfetch → websearch raw/mirror → user paste + mark unverified), evidence contract (claim + URL + version + snippet; never invent APIs; conflicts shown), output format. Both skill descriptions now carry trigger lists. Skills live-link from dotfiles; `researcher` agent takes effect at next hm-switch.
> 2026-09-11 — dropped the `playwright` MCP (`bun x @playwright/mcp`): browser automation is the `agent-browser` CLI skill (0.27.0, `~/.local/bin/agent-browser`), already the AGENTS.md-mandated workflow (snapshot-first, no vision). Removes the stray `.playwright-mcp/` browser-state dir from workspaces; `.gitignore` guards it anyway. `extract-design-system` keeps its own Node `npx playwright install chromium` — unaffected. Live `opencode.jsonc` takes effect at next hm-switch (nix store symlink).
> 2026-09-11 — designer skill rewritten graph-first (design-thinking method): two modes (Produce/Review) with explicit break points (no authority → ask; gate fails → no handoff; artifact vs project system → project wins; implementation better → update artifact), Project authority section (project-declared system/paths/gate win), Produce pipeline (authority → design-graph for flows/void states → tokens → exact-value artifact → gate → handoff), artifact anatomy (tokens, surfaces + Surface<C,V,N> void states, state matrix, layout, motion, a11y, copy), and a Handoff contract making the artifact the thing swe implements verbatim; specialist routing (design-graph / frontend-design / design-system-patterns / extract-design-system) replaces the duplicated frontend-design aesthetics prose; Review mode with severity+evidence grading and drift-routes-back-to-design rule; description now carries the trigger list ("Load before touching any design artifact or reviewing UI"). Agent deduped to a single skill pointer (removed the redundant workflow/build-gate line and the dead skill-load-fallback clause). Eval suite persisted at `config/skills/designer/evals/` (2 prompts, 8 assertions; smoke + no-hint runs 8/8 new vs 5/8 old — void states, handoff contract, graph routing the discriminators; authority discovery non-discriminating).
> 2026-09-11 — reviewer hardened: `reviewer` skill now enforces CONFIRMED/SUSPECTED evidence, no-diff handling (never invent findings on an empty change), change-vs-pre-existing scope split, explicit verdict criteria, and severity calibration by impact; permissions add `external_directory *` (reads outside the workspace, incl. /tmp) plus `cd *` and read-only git expansion (grep/ls-files/rev-parse/rev-list/merge-base/cat-file/describe/shortlog/stash list+show/worktree list/remote -v+show/branch --show-current+--list); skill `*` allow so a project-local review skill can load, and a Project authority section makes project-declared review rules win over the skill's defaults; reviewer is now caveman-exempt (full-prose output; `caveman` skill denied) so findings keep their nuance; on-request-only HTML report mode (bundled `assets/review-report.html`; sole permitted writes are `.reviews/*` (repos) and `~/.local/share/opencode/reviews/*` (non-repos), dirs created via allowlisted `mkdir -p`). Eval suite persisted at `config/skills/reviewer/evals/` (7 fixtures; iteration 2 separated revised vs old skill 92% vs 81%).
> 2026-09-11 — exported the architect process to the repo-authored, harness-agnostic `architect` skill (harness contract, stage-by-artifact router, ADR status-graph lifecycle, wrap-up format). The opencode `architect` agent is now a thin envelope (identity + permissions + skill pointer); other harnesses wire the same skill into their own agent. Re-added `architect` to the repo-authored exceptions.
> 2026-09-11 — dropped the `architect`/`planner` wrapper skills: `brainstorm-studio` already owns the design stage and `writing-plans` the plan. The `architect` agent is now a read-only single-stage router over vendored processes: `brainstorm-studio` (text-only) / `system-design` + `architecture` (lasting decision → ADR) / `writing-plans`; parent persists each artifact. Added `skill *` allow to `architect`, `designer`, `researcher` — routing was permission-blocked (only `swe`/`reviewer` had it). ADR management moved into the architect prompt: status vocabulary (proposed/accepted/deprecated/superseded/obsolete/rejected), scan-classify with evidence (scope exists/code agrees/premise holds/still recommended), stale-vs-irrelevant rules, explicit audit mode returning `## ADR status changes`, `last-reviewed` anti-rot, parent persists/commits + `manage_adr` registration. Architect gained codebase-memory read tools (search_graph/detect_changes/get_code_snippet/check_index_coverage) as optional enrichment — relevance checks are graph-grounded when the MCP is installed/indexed, and fall back to read/grep/glob + `git log` otherwise; never blocking. Default ADR dir `.agents/adr/`, project-declared location wins.
> 2026-09-11 — removed stale `brainstormer` role skill; `brainstorm-studio` is now the brainstorming entry point and adopts the `design-thinking` graph-first paradigm (draw the design as a graph; route by material to `design-thinking` / `design-graph` / graph-protocol / `call-graph`; carry the graph into the spec). Added a read-only/headless note to `brainstorm-studio` so the read-only `architect` agent can still use it text-only. Updated architect agent routing, architect/planner spec-source refs, and the repo-authored exceptions list.
> 2026-09-11 — renamed repo-authored role skills, dropped the `agents-` prefix: `agents-architect`→`architect`, `agents-brainstormer`→`brainstormer`, `agents-designer`→`designer`, `agents-explorer`→`explorer`, `agents-librarian`→`librarian`, `agents-planner`→`planner`, `agents-reviewer`→`reviewer`, `agents-swe`→`swe` (`agents-sdk` kept — vendored upstream). Updated frontmatter `name`, agent routing refs (`config/opencode/agents/*.md`), `.gitignore` comment, reviewer `evals/`+`assets/` self-refs, and the two-tier memory paths (`~/.agents/memory/swe.md`, `<repo>/.agents/memory/swe.md`).
> 2026-09-11 — `swe` memory is two-tier: project `<repo>/.agents/memory/swe.md` (gitignored) + skill-owned `~/.agents/memory/swe.md` (cross-project, machine-local). Read both project-first; write project by default, promote repo-independent lessons. Plus conditional MCP layer (engram `mem_*` + codebase-memory read tools) only when both installed; `swe` permissions allow them (engram action names inferred from the `codebase_memory_mcp_*` convention — verify after hm-switch).
> 2026-09-11 — stack conventions moved to project-local skills: removed default `frontend`/`backend`/`cli` + all stack variants (`tanstack-*`, `backend-effect-bun`, `cli-bun-effect`, `bun-runtime`, `effect-ts`, `effect-v3-to-v4`, `tailwind-4-docs`, `tailwind-design-system`, `tiptap`). Dropped `swe/available-skills.toml` — agent discovers skills itself. Global keeps agent roles, quality/workflow, general skills.
> 2026-09-11 — Agent Skills standard (agentskills.io): fixed `physics-3d-collision` invalid YAML + 6 `ckm:` names (→ dir name); added `scripts/validate-skills.sh` wired into `validate.sh` Check 7 + CI. Validator recognizes Claude Code extensions (`argument-hint`/`user-invocable`/`disable-model-invocation`); leftover 23 warnings = 13 vendor-only-key skills + 9 long bodies — accepted as-is (no vendored-frontmatter edits)
> 2026-09-11 — agents genericized (Option A): global agents no longer hardcode project structure (`app/`/`server/`/`shared/`/`cli/`, wireframes submodule, TanStack/Effect stack pins). `swe` is now a general SWE; `designer` defers design paths/build gates to the project's `AGENTS.md`/`.opencode`. Project-specific rules stay in the owning repo (lexa). Option C (split global vs per-project roster) deferred — memory topic `opencode/agent-genericization`
> 2026-09-11 — model pins (quality-first): architect/reviewer `opencode-go/deepseek-v4.1-flash#max`, swe/designer `#high`; researcher/vision `opencode-go/mimo-v2.5`
> 2026-09-11 — agent consolidation: explorer+librarian→`researcher`; architect+brainstormer+planner→`architect`; `designer` design-only (no app code); `swe` sole implementer
> 2026-09-11 — agent IDs renamed: `designer`, `explorer`, `librarian` (dropped `-jr` suffix); agent files + AGENTS.md + goal skill refs updated
> 2026-09-10 — cbm-augment V2 fix (default export id + setup/setup, V1 server kept)
> 2026-09-08 — subagents TUI crash fix (prop-drilled context, `@opencode/plugin/tui` specifier, dropped `@opencode-ai/plugin` dep)
> 2026-09-07 — no pinned `model` (session follows TUI selection, subagents inherit); cli.json syncs `tabs.layout: vertical`
> 2026-09-06 — v2 cleanup (v1 archived, plugins removed except herdr, rtk MCP added, agents V2-native)

## Stack Overview

```
opencode2 (@opencode/cli@beta) + OpenCode Go provider ($10/mo)
├── ~/.config/opencode/          → harness config
│   ├── opencode.jsonc           → main config (v2 minimal, home-manager managed)
│   ├── cli.json                 → CLI prefs (managed)
│   ├── AGENTS.md                → agent behavior rules (global, manual sync from dotfiles)
│   ├── CONFIGURATION.md         → this file (managed)
│   ├── agents/*.md              → 9 custom agents, V2 permissions (managed)
│   ├── commands/                → /goal + /design-thinking (nix-managed from config/opencode/commands/; /design archived)
│   ├── tools/                   → image.py only (manual, unmanaged; image.ts archived)
│   ├── plugins/                 → herdr-agent-state only (live, unmanaged; rest archived)
│   └── (no skills/ dir — single root `~/.agents/skills/`, restored 2026-09-06)
│   └── MCP (3)                  → engram, codebase-memory-mcp, rtk
├── ~/.agents/skills/            → cross-harness skills (canonical)
└── ~/.config/opencode-archive-v1-20260906/ → v1 archive (see below)
```

## Main Config (`opencode.jsonc`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode-go/muse-spark-1.3-contributor",
  "permission": "allow",
  "default_agent": "build",
  "agents": {
    "build": { "mode": "all" }
  },
  "lsp": true,
  "compaction": { "auto": true, "buffer": 10000 },
  "providers": {
    "opencode-go": { "settings": { "baseURL": "http://127.0.0.1:8787/v1" } },
    "opencode": { "settings": { "baseURL": "http://127.0.0.1:8788/v1" } },
    "openrouter": { "settings": { "baseURL": "http://127.0.0.1:8789/v1" } }
  },
  "mcp": {
    "engram": { "command": ["engram", "mcp", "--tools=agent"], "enabled": true, "type": "local" },
    "codebase-memory-mcp": { "enabled": true, "type": "local", "command": ["codebase-memory-mcp"] },
    "rtk": { "command": ["rtk-mcp"], "enabled": true, "type": "local" }
  },
  "shell": "/usr/bin/zsh"
}
```

Key: no `plugin` entries (only live-local herdr-agent-state, not in config); provider baseURLs point at the local proxy ports (787/788/789); three MCPs only — browser automation is agent-browser CLI (skill `agent-browser`; preferred per AGENTS.md), not an MCP; built-in build runs `mode: all` so it works as subagent; built-in explore/general enabled (custom researcher/architect/designer/swe/reviewer kept alongside); compaction native V2 (`buffer`, no `reserved`/`prune`).

## Agents (`~/projects/dotfiles/config/opencode/agents/*.md`)

All custom: `mode: all` (vision: subagent). Model pins (quality-first): `architect`/`reviewer` = `opencode-go/deepseek-v4.1-flash#max`; `swe`/`designer` = `opencode-go/deepseek-v4.1-flash#high`; `researcher`/`vision` = `opencode-go/mimo-v2.5` (cheapest clean quota: 30.1k req/5h, 0 retention; no variants). An agent's `model` applies to child/subagent sessions only — a primary `opencode2 run --agent` session has its own model, so lanes pass `--model provider/model#variant` explicitly. Agents are thin skills routers: identity + permission envelope + skill pointer by name, deny-by-default `permissions` ordered rules, `steps` caps. Consolidated 2026-09-11 (explorer+librarian→`researcher`; architect+brainstormer+planner→`architect`; `designer` design-only; `swe` sole implementer). Native V2 frontmatter only (`description`/`mode`/`steps`/`permissions` — legacy top-level `temperature` + V1 `permission` blocks removed 2026-09-06; per V2 docs, request overlays like temperature are not applied by the runner, so effective tuning lives on provider/model/variant). All prompts end with a caveman output mandate: ultra-terse fragments, no filler/narration, substance-only reports; vision keeps transcriptions verbatim; reviewer is exempt (full prose, `caveman` skill denied — compression weakens review findings).

| Agent | Steps | Guardrails |
|-------|-------|------------|
| swe | 60 | read/glob/grep/list/edit/shell/skill allow; web+question+subagent deny; external_directory `*` allow (all dirs); MCP allows: engram `mem_*` (4) + codebase-memory read tools (11) — used only when both are installed. General SWE, sole implementer; module layout detected from repo, design authority from project config; two-tier memory: `<repo>/.agents/memory/swe.md` (project, gitignored) + `~/.agents/memory/swe.md` (skill-owned) + optional engram/codebase-memory. Skill: `swe` (routing hub) |
| researcher | 40 | read/glob/grep/list/skill + webfetch/websearch allow; MCP allows: codebase-memory read tools (11) — optional, grep fallback when absent/unindexed; subagent deny; model `opencode-go/mimo-v2.5`. Routes: `explorer` (locate) / `call-graph` (trace) / `librarian` (external); locate+external → codebase first |
| architect | 50 | read-only; skill `*` allow; graph read allows (search_graph/detect_changes/get_code_snippet/check_index_coverage) — optional, used only when codebase-memory is installed/indexed, never blocking; web ask; question allow; subagent deny. Thin envelope: loads the repo-authored, harness-agnostic `architect` skill (stage router + ADR status-graph lifecycle); the skill owns the process, the agent supplies identity/permissions/model |
| designer | 50 | read + edit + skill allow; shell ask; web ask; question allow; subagent deny. Design only — no implementation source; design-artifact paths + build gate come from the project's `AGENTS.md`/`.opencode`. Thin envelope: the `designer` skill owns produce/review workflows, artifact anatomy, session authority, and the handoff contract; agent loads it, routes to specialist skills, never implements |
| reviewer | 40 | read-only; external_directory `*` allow (reads outside workspace, e.g. /tmp); skill `*` allow (reviewer, project-local review skills) then `caveman` denied (full-prose output); Project authority — project-declared review rules/skills win over defaults; HTML report on explicit user request only (template `assets/review-report.html`; output `<repo>/.reviews/` in repos, `~/.local/share/opencode/reviews/` otherwise); graph read (search_graph/trace_path/get_code_snippet/check_index_coverage); shell: `cd *` + `mkdir -p .reviews` + `mkdir -p ~/.local/share/opencode/reviews` + read-only git (diff/status/log/show/blame/grep/ls-files/rev-parse/rev-list/merge-base/cat-file/describe/shortlog/stash list+show/worktree list/remote -v+show/branch --show-current+--list) allow, rest ask; edit deny except `.reviews/*`, `*/.reviews/*`, `~/.local/share/opencode/reviews/*`; question/subagent deny |
| vision | 10 | read only; model `opencode-go/mimo-v2.5` (unverified vision; fallback `deepseek-v4-flash-vision-exp`) |

## Skills System (2026-08-13 overhaul)

- **Standard**: every `SKILL.md` follows the open Agent Skills spec (agentskills.io) — required `name` (lowercase-kebab, must equal dir, ≤64) + `description` (≤1024); optional `license`/`compatibility`/`metadata`/`allowed-tools`. Portable across Claude Code, Codex CLI, Gemini CLI, Copilot, Cursor, opencode. Validator: `scripts/validate-skills.sh` (`--strict` fails on warnings, `--verbose` lists them); run in `validate.sh` Check 7 + CI.
- **Vendored skills**: `config/skills/*` is populated by `npx openskills install` (writable out-of-store symlink). Treat frontmatter as upstream-owned — do NOT hand-edit it (drift; overwritten on update). Local edits only to repair discovery (invalid YAML, `name` ≠ dir, missing required field); re-apply after `openskills` updates. Repo-authored exceptions: `architect`, `brainstorm-studio`, `designer`, `explorer`, `git-workflow`, `goal`, `librarian`, `reviewer`, `swe`, `work-plans`. Unknown top-level keys are spec-legal (tooling must preserve them) — validator warns, never errors, and recognizes the Claude Code extensions above.
- Discovery: dirs only, recursive. `~/.agents/skills/` (canonical, single root since 2026-09-06 — `config/opencode/skills/` deleted, no `skills` mapping in default.nix), project `.agents/skills/`. Live `~/.config/opencode/skills/` is an empty leftover dir. No AGENTS.md tables — auto-discovery.
- Load: native `skill` tool first; `npx openskills read` fallback.
- **Stack skills are project-local** (2026-09-11): all runtime/framework conventions (frontend, backend, cli, tanstack, bun/effect, tailwind) removed from the global root; projects ship their own under `.agents/skills/`. Global root keeps agent roles, quality/workflow, and general-purpose skills.
- Routing: `swe` step 2 detects the stack of touched files (manifests, code — not assumed dir names) and loads the matching skill, preferring project-local stack skills.
- Wiring: `designer` → wireframes + design-system/token artifacts ownership; the repo-authored `designer` skill owns produce/review modes, project authority, artifact anatomy, and the swe handoff contract, routing craft to `design-graph` (flows/void states) / `frontend-design` (visual direction/motion) / `design-system-patterns` (tokens/theming); `brainstorm-studio` → visual brainstorming companion (browser mockups/diagrams/side-by-side) + graph-first design via `design-thinking`/`design-graph`; defers core process to `brainstorming`; returns the design + its graphs for the parent to persist as the spec. Lasting decisions consult `system-design` + `architecture` (ADR) on demand; `writing-plans` produces the plan. `architect` (repo-authored, harness-agnostic) is the portable design-lead process — stage routing + ADR lifecycle with a harness contract; the opencode agent of the same name is a thin read-only envelope that loads it, and other harnesses wire the same skill into their own agent. (The earlier design-stage `architect` and `planner` wrappers were removed — this skill owns the router and lifecycle, not a duplicate design stage.) Chain: brainstorm-studio → [system-design/architecture] → writing-plans → swe.
- YAML gotcha: unquoted frontmatter descriptions with `: ` silently break discovery (killed frontend + effect-ts 2026-08-13; fixed via single-quoted descriptions).
- `~/AGENTS.md` deleted 2026-08-13 (stale catalog; redundant with native `<available_skills>` injection). Not chezmoi-managed.
- Caveman mode now in all 3 harnesses: opencode AGENTS.md, `~/.commandcode/AGENTS.md`, `~/.hermes/SOUL.md` (seeded 2026-08-13).
- Cross-harness scan: opencode/hermes/commandcode recursive; Claude Code/Gemini/Cline/Roo shallow — irrelevant (unused).
- `nix/` skill replaced 2026-09-10 with `r17x/universe:.claude/skills/nix` (SKILL.md + debug/flake/module/service sub-skills; eval/debug/build/service focused). Old generic skill backed up at `/tmp/opencode/nix-backup-2026-09-10/`.

## AGENTS.md Sections

Memory (engram: session start → mem_current_project + mem_context; conflicts via mem_judge), Caveman Mode (incl. subagent inheritance: delegation prompts must carry "reply caveman-compressed" line; custom agent prompts embed the mandate; reviewer exempt), Tool Selection (incl. rtk preference; researcher-first delegation — build/primary delegates multi-file exploration and all web research to `researcher` by default, cheap single-file lookups inline only), Codebase Knowledge Graph (codebase-memory-mcp: session-start index check, tool routing table — search_graph/get_code_snippet/trace_path×3/query_graph/search_code/detect_changes, grep fallback rules, delegation qualified_name passing), Agent-Browser, Code Style, Quality, Error Recovery, Quality Gates (agent selection table incl. researcher as default for API/library + codebase exploration, design-artifacts→designer, design/ADR→architect), Prompt Templates, Commit Rules, Safety, Tool Installation Automation.

## DCP (`dcp.jsonc` — archived 2026-09-06)

Removed with the plugin purge. Upstream DCP slowed (focus moved to Sleev), V1-only (V2 breaks all V1 plugins), and our copy referenced stale V1 tool names. V2 native compaction (`buffer: 10000` in opencode.jsonc) covers the basics. File archived at `~/.config/opencode-archive-v1-20260906/dcp.jsonc`; mapping dropped from default.nix. Revisit if a V2-compatible DCP/Sleev integration appears.

## MCP Servers (3)

| Server | Type | Purpose |
|--------|------|---------|
| engram | Go binary `~/go/bin/engram` | Memory: SQLite+FTS5 `~/.engram/engram.db`, agent-only tools. `~/.engram/config.json` pins project_name=`opencode-dotfiles` for home-cwd writes (fixes ambiguous_project from lexa-* worktrees in $HOME; HOME config doesn't leak into repos) |
| codebase-memory-mcp | static C binary | Knowledge graph, 14 tools, 66 langs |
| rtk | `~/.local/bin/rtk-mcp` (added 2026-09-06) | Token-optimized shell via `run_command` (allowlisted cmds, 60-90% savings). AGENTS.md Tool Selection: prefer `rtk` prefix / `run_command`, raw shell only when rtk lacks the command. Auto-rewrite plugin deferred (V2 plugin API unstable) |


Removed with v1 2026-09-06: `context7`, `grep_app`, `websearch` (remote MCPs from old `opencode.json`).
Removed 2026-09-11: `playwright` MCP (`bun x @playwright/mcp`) — replaced by the `agent-browser` CLI skill (0.27.0 at `~/.local/bin/agent-browser`), preferred by AGENTS.md and already the mandated browser workflow (snapshot-first, no vision). `extract-design-system` keeps its own `npx playwright install chromium` (Node, independent of the MCP).

## Removed 2026-09-07

- **CommandCode (CC)** — full removal: pacman `command-code` pkg (`/usr/bin/commandcode`), `cc-proxy.service` user unit (npx commandcode-api-proxy :8787, held CC_API_KEY), `~/.commandcode/` data, `~/.local/bin/cc-key`. `/usr/bin/cc` untouched (gcc symlink, separate pkg). opencode-go/zen gateway unaffected — direct auth verified post-removal.
- **gmicloud provider** — dropped per user request (3 providers remain: opencode-go, opencode, openrouter); auth entry removed from `auth.json`.

## Headroom compression proxy (2026-09-07, active)

69k★ `headroomlabs-ai/headroom` v0.37.0, installed via `uv tool install "headroom-ai[all]"`. Three systemd user units, one per upstream (native `--openai-api-url` routing):

| Unit | Port | Upstream | Kompress ML |
|---|---|---|---|
| `headroom-opencode-go.service` | 8787 | https://opencode.ai/zen/go | on (primary) |
| `headroom-opencode.service` | 8788 | https://opencode.ai/zen | off |
| `headroom-openrouter.service` | 8789 | https://openrouter.ai/api | off |

opencode.jsonc `providers.<id>.settings.baseURL` points at `http://127.0.0.1:87xx/v1`. Beacons off, rate-limit off, default `coding` profile (cache mode, prefix-safe, file reads never lossy).

**Gotchas learned**: (1) `x-headroom-base-url` header routing (shim-style) 502s silently in 0.37.0 — use native `--openai-api-url` per upstream instead; one instance per upstream. (2) auth.json zen tokens go stale; live tokens ride per-request from opencode2 — manual curl with auth.json token shows false 500/401. (3) `--port` omitted = default 8787, collides. Verify traffic: `curl -s http://127.0.0.1:8787/stats` → `summary.api_requests`.

## Global Gitignore

Agent files: .opencode/, opencode.json, .cursor*, .claude/, CLAUDE.md, .codex/, AGENTS.md, .gemini/, GEMINI.md, .windsurf/, .engram/, .aider/, .amazonq/.

## OpenCode Go Limits

5h $12 / week $30 / month $60. Est: flash 31.6k req/5h, pro 3.4k, kimi 1.1k.

## Plugins

- `opencode-subagents` (added 2026-09-07, dotfiles-managed via `opencodeSyncPlugins` home-manager activation in `home/modules/opencode/default.nix` — copied as real files from `config/opencode/plugins/opencode-subagents/` into `~/.config/opencode/plugins/opencode-subagents/` on every switch, with `bun install` when node_modules missing; real files required because bun resolves imports from file realpath, so nix-store symlinks would never see node_modules): V2 TUI plugin — sidebar section listing live subagents (child sessions) of the current session. Source: `config/opencode/plugins/opencode-subagents/` (index.ts server stub, tui.tsx slot wiring, types.ts contract, useSubagents.tsx data, SubagentSection.tsx tree, variants.ts V states). Slot `append: "sidebar.content"`; live via `data.listen` + 2s poll; header click toggles collapse (mouse toggle verified only for layout, synthetic-pty mouse never reaches slot content — real-terminal click untested). One line per subagent (agent, status, model/provider, elapsed, tokens) + title/model line — no expand/border (see gotcha). `tui.tsx setup(context)` prop-drills `data` + `theme` into `SubagentSection` — no `usePlugin()` (see gotcha 4). Gotchas (verified empirically 2026-09-07, opencode2 beta-19242, sandbox fake-HOME + `--server` attach):
1. TUI plugin runtime loader only aliases `solid-js`/`solid-js/store` for `.tsx` files — bare `solid-js` imports in `.ts` files fail with `Cannot find package 'solid-js'` at load. Any plugin file importing solid must use `.tsx` (JSX not required).
2. A `box` with `border`/`title` props inside a TUI slot FREEZES the whole renderer at first paint (no crash log, blank screen). Never use border/title in slot content — plain `box` + `text` is fine (signals/timers render normally). Also in the REAL TUI sidebar, flex spacers (`flexGrow`) inside slot rows collapse — children render sequentially with no gap and overflow wraps. Every slot line must be ONE space-padded string per text node; content width measured = 37 cols (pane inset 2 left, ends col 77 on 80-col terminal). Host visual language (measured from ANSI frames): label bold `text.default` at col 41, items `• name` (bullet U+2022, success-green), right meta muted, blank line between sections.
3. TUI plugins are not logged by the plugin loader; failures show only as an in-TUI banner. To debug headless: run `opencode2 serve --port <p>` in a fake HOME, create a session via its OpenAPI (`POST /api/session`, basic auth `opencode:<password from serve log>`), then `opencode2 --server http://127.0.0.1:<p> -s <ses_id>` in a pty.
4. Never `usePlugin()` inside a slot render (2026-09-08, host beta-19289): the host binary only provides `@opencode/plugin/tui` while the plugin depended on `@opencode-ai/plugin@beta` (resolved beta-19271), whose bundled `solid-js` copy differs from the host's — `useContext` misses the host's provider and the slot crashes with `PluginContextProvider is missing`. Fix: import `Plugin` from `@opencode/plugin/tui` (host-resolved, zero-install — same as `herdr-agent-state`), drop the `@opencode-ai/plugin` dep, and prop-drill `setup(context)` values (`data`, `theme`) into slot components. `bun.lock` stays live-only/untracked.
- `herdr-agent-state` (restored 2026-09-06 from beta profile, V2-native TUI pane reporter; live only, not in dotfiles). Everything else removed 2026-09-06, pending rebuild.
- `cbm-augment` (fixed 2026-09-10, live only `~/.config/opencode/plugins/cbm-augment.ts`, not in dotfiles): was V1-only named export `CodebaseMemory`, failed server load `err_789908a8` (`SchemaError(Missing key at ["default"])`). Rewrote as plain-object default export `{ id: 'cbm-augment', setup(), server() }` (no SDK import, same as herdr stub pattern). V2 `setup` uses `ctx.tool.hook('execute.after')`, skips errors, maps grep/glob case-insensitive, resolves spawn cwd from `args.path` (hook binary resolves repo from cwd; without this, server-cwd dotfiles/unindexed always yields empty), appends `hook-augment` output to `event.result.output`; V1 `server()` keeps `tool.execute.after` with fixed `input.args` source. Generator markers removed (ownership taken); `codebase-memory-mcp install/update` may recreate V1 file — dedupe if it returns.
Dropped 2026-09-06: engram V2 port attempt (`plugins/engram/index.ts`, ported from upstream v1) — failed to load (server can't resolve `@opencode-ai/plugin` bare import; plain-object export then hit a transpile syntax error). Safe without it: memory works fully via MCP; the plugin only added automation (prompt/passive capture, nudges, compaction checkpoint). Revisit when V2 plugin API stabilizes.
Archived under `~/.config/opencode-archive-v1-20260906/`:
- `plugins-live/`: background-agents.ts, engram.ts, herdr-agent-state.js, herdr-agent-state-v2.js, kdco-primitives/, notify/, notify.ts, rtk.ts, worktree/, worktree.ts (+ `*.backup` files)
- `dotfiles/plugins/`: dotfiles copies of the above (minus herdr-agent-state-v2.js)
- `tui/`: herdr-tui-session.js + tui.jsonc (TUI plugin ref)
- npm plugins dropped from config: `@tarquinen/opencode-dcp`, `oh-my-opencode-slim`
- runtime manifests: package.json, package-lock.json, bun.lock (live `node_modules/` 87M deleted — regenerable via `bun install`)

## V1 Archive (`~/.config/opencode-archive-v1-20260906/`)

Archived 2026-09-06 during opencode2 migration:

| Path | Content |
|------|---------|
| `opencode.json` / `.bak` / `.pre-cmd-removal` | v1 main config (presets gmicloud/opencode-go, provider gmicloud MiniMax M3/M2.7, plugins omo-slim+dcp, remote MCPs) |
| `oh-my-opencode-slim/` | prompt overrides (`opencode-go/*_append.md`) |
| `.oh-my-opencode-slim/` `.ocx/` `.opencode/` | plugin caches |
| `oh-my-opencode-slim.json.backup` + `.managed-copy` | OMO-slim preset config |
| `live-v1-more/` | round 2: `commands/design.md` (dead `cc-design` ref), `service.json` (v1 service password), `tools/image.ts` (v1 SDK import), `skills/codemap` + `skills/simplify` (omo-bundled) |
| `dotfiles-more/` | dotfiles-side round 2: `tools/image.ts`, `skills/codemap/`, `skills/simplify/` |
| `dotfiles/` | dotfiles-side v1: opencode.json, oh-my-opencode-slim.json, tui.json (omo TUI plugin), package.json, skills/oh-my-opencode-slim |
| `skills-opencode-final/` | round 3: `clonedeps/deepwork/verification-planning/worktrees` (dotfiles-side omo-era dupes) + `live/` (live copies incl. `reflect`, moved to canonical `config/skills/`) |
| `live-v1-more/skills-backup/` | `*.backup` leftovers from live skills dirs |
| `dotfiles-dot-opencode/` | `~/projects/dotfiles/.opencode/` project-local v1 (opencode.json + `plugin: ["list"]`, package manifests; 62M node_modules deleted, dir removed) |
| `engram-config.json.backup` | stale `~/.engram/config.json` backup |
| `beta/` | beta profile: `opencode/` (o2 config) + `o2` wrapper script |
| `tui.json.managed-copy`, `tui.json.backup`, `tui.json.bak` | v1 TUI configs |
| `*.backup` / `*.bak` | all other backups (agents, cli, dcp, CONFIGURATION) |

Removed from dotfiles (git deletions, uncommitted): `config/opencode/opencode.json`, `config/opencode/oh-my-opencode-slim.json`, `config/opencode/tui.json`, `config/opencode/package.json`, `config/opencode/skills/` (entire dir: oh-my-opencode-slim, codemap, simplify, clonedeps, deepwork, reflect→moved to `config/skills/`, verification-planning, worktrees), `config/opencode/tools/image.ts`, `config/opencode/plugins/*`. Removed from `home/modules/opencode/default.nix`: `tui.json` + `oh-my-opencode-slim.json` + `skills` mappings; activations rewritten (`opencodeBunInstall` targets `@opencode-ai/cli@beta`, `opencodeFixPlugins` replaced by `opencodeSyncTools`).
Deleted (not in dotfiles, not archived — regenerable/quit): live `node_modules/` (87M).
Beta profile deleted: `~/.config/opencode-beta/opencode/`, `~/.local/bin/o2` (use `opencode2` + main profile now; `google-chrome/` + data dirs under opencode-beta left untouched).

## Design Decisions (recent; full history in git)

- 2026-09-09: deleted 7 omo-era skills (codemap, clonedeps, worktrees, deepwork, simplify, reflect, verification-planning); dropped `simplify` from AGENTS.md refactor template, removed dead slim Check 4 from validate.sh, debranded SOUL.md. Lane isolation covered by `using-git-worktrees`; no live cross-refs remain.

- 2026-09-06: v2 migration — archived v1 (opencode.json, omo-slim, gmicloud preset/provider, remote MCPs), removed plugins (herdr-agent-state restored from beta profile), deleted beta profile + `o2` wrapper, main profile minimal + shell/lsp/compaction/playwright. Custom agents migrated to native V2 (temperature + V1 permission blocks dropped, model-agnostic). Skills back to single root (`config/skills/` canonical, incl. rescued `reflect`). rtk MCP added (`run_command`; auto-rewrite plugin deferred). engram 1.15.7→1.20.0. default.nix activations rewritten for `@opencode-ai/cli@beta`. Compaction migrated to native V2 (`buffer`, dropped ignored `reserved`/`prune`).
- Removed 2026-09-05: `lexa-swarm` skill (user request; source `config/skills/lexa-swarm` deleted, backup kept at `~/.agents/skills.backup/`)
- Fixed 2026-09-08: opencode2 stale-version bug — `opencodeBunInstall` + `install-manual.sh` updated deprecated `@opencode-ai/cli@beta` (stalled 19271) while live `opencode2` bin actually comes from `@opencode/cli@beta` (19296). Targets switched to `bun install -g --trust @opencode/cli@beta`, so every `home-manager switch` re-resolves `@beta` → latest.
- Added 2026-09-05: `design-thinking` skill (SKILL.md router + refs/design-thinking.md, design-graph.md, graph-protocol.md, output-format.md; source r17x gist). Single ID; no AGENTS.md rule needed (auto-discovery).
- Updated 2026-09-08: `design-thinking` reframed as graph-first paradigm (umbrella: program A/E/R + orchestration delegation). Promoted its two materials into standalone skills for independent auto-discovery: `call-graph` (how-it-works/caller/trace answers, ts-fence call graph; refs/output-format.md moved out) and `design-graph` (interface Surface<C,V,N>; refs/design-graph.md moved out). All three cross-link as one r17x paradigm. Refs verified in sync with gist revision 06f999d (local = condensed paraphrase, same sections; output-format.md superset of gist's ECALL file).
- Added 2026-09-05: `/design-thinking` command (`~/.config/opencode/commands/design-thinking.md`, mirrors `design.md` pattern; loads skill, routes $ARGUMENTS). Global commands dir unmanaged by home-manager — file lives only in ~/.config.
- Chose engram over opencode-mem (no API key)
- Agent family + routing skills (2026-08-13): thin agents, thick skills, deny-by-default
- Nested skill dirs: opencode uses dir basename as ID — collisions displace (tested); variants keep unique names
- DB folded into backend (no separate skill); system design → architect, design artifacts → designer
- Skills installed globally only; never vendored in repos (gitignore `.agents/`)
- Removed 2026-08-13: Cloudflare MCP×6, Postgres MCP, lexa MCP, commandcode Go-proxy, cloudflared
