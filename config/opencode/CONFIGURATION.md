# OpenCode Configuration

> Last updated: 2026-09-05

## Stack Overview

```
OpenCode Go (provider, $10/mo)
├── ~/.config/opencode/          → harness config
│   ├── opencode.json            → main config
│   ├── cli.json / tui.json      → TUI
│   ├── dcp.jsonc                → dynamic context pruning
│   ├── AGENTS.md                → agent behavior rules (global)
│   ├── CONFIGURATION.md         → this file
│   ├── agents/*.md              → 8 custom agents (V2 permissions)
│   ├── MCP (3)                  → engram, playwright, codebase-memory-mcp
│   ├── skills/                  → removed 2026-08-13 (all moved to ~/.agents/skills, incl. cc-design)
│   └── plugins/                 → local file plugins (rtk, engram, background-agents, notify, worktree, kdco-primitives)
├── ~/.agents/skills/            → cross-harness skills (canonical, chezmoi dot_agents/skills/)
├── ~/.commandcode/AGENTS.md     → commandcode user-tier memory (caveman rules)
└── ~/.hermes/SOUL.md            → hermes identity (caveman rules)
```

## Main Config (`opencode.json`)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "allow",
  "default_agent": "build",
  "agent": { "explore": { "disable": true }, "general": { "disable": true } },
  "model": "opencode/x-preview-f-free",
  "lsp": true,
  "compaction": { "auto": true, "prune": true, "reserved": 10000 },
  "mcp": {
    "engram": { "command": ["engram", "mcp", "--tools=agent"], "enabled": true, "type": "local" },
    "playwright": { "command": ["bun", "x", "@playwright/mcp"], "enabled": true, "type": "local" },
    "codebase-memory-mcp": { "enabled": true, "type": "local", "command": ["codebase-memory-mcp"] }
  },
  "shell": "/usr/bin/zsh",
  "plugin": ["@tarquinen/opencode-dcp@latest"]
}
```

Key: preset `gmicloud` (gmicloud M3#thinking default, M2.7 for swe, mimo-v2.5-free for vision); default_agent build; built-in explore/general disabled (custom agents replace).

## Agents (`~/.config/opencode/agents/*.md`) — V2 permissions 2026-08-13

All: `mode: all` (vision: subagent), thin shells (identity + guardrails + skill pointer by name), deny-by-default `permissions` ordered rules, `steps` caps. Dual-format frontmatter: V2 `permissions` array + V1 `permission` object (V1 1.18.16 reads same agents/ dir; V1 defaults permissive so blocks deny non-granted tools + external_directory; only swe allows external `*`). All prompts end with a caveman output mandate (2026-08-21): ultra-terse fragments, no filler/narration, substance-only reports; vision keeps transcriptions verbatim.

| Agent | Temp | Steps | Guardrails |
|-------|------|-------|------------|
| swe | 0.2 | 60 | read/glob/grep/list/edit/shell allow; web+subagent deny; external_directory `*` allow (all dirs). Skill: `agents-swe` (routing hub). Model via `presets.gmicloud`. Dual-format frontmatter: V2 `permissions` array + V1 `permission` object |
| planner | 0.2 | 40 | read-only; web ask; question allow; subagent deny. Skill: `agents-planner` (wraps `writing-plans` process; expects designed input). Model via `presets.gmicloud` |
| architect | 0.4 | 40 | read-only; web ask; question allow; subagent deny. Skill: `agents-architect` (wraps `system-design` + `architecture`; owns design + ADR). Model via `presets.gmicloud` |
| reviewer | 0.1 | 40 | read-only; shell: git diff/status/log/show allow, rest ask; subagent deny. Model via `presets.gmicloud` |
| brainstormer | 0.8 | 30 | read-only; web ask; question allow; subagent deny. Skill: `agents-brainstormer` (wraps `brainstorming` process). Model via `presets.gmicloud` |
| designer-jr | 0.7 | 50 | edit+shell allow; web ask; question; subagent deny. Owns wireframes. Model via `presets.gmicloud` |
| explorer-jr | 0.1 | 30 | read/glob/grep/list only. Model via `presets.gmicloud` |
| librarian-jr | 0.1 | 40 | read tools + webfetch/websearch allow; no bash. Model via `presets.gmicloud` |
| vision | 0.1 | 10 | read only. Model via `presets.gmicloud` (`opencode/mimo-v2.5-free`) |

Migration: V1 `permission` maps → V2 `permissions` ordered rules (`bash`→`shell`, `task`→`subagent`), wildcard-first + narrow-after. V1 configs still compatible.

## Skills System (2026-08-13 overhaul)

- Discovery: dirs only, recursive. `~/.agents/skills/` (canonical — now includes `cc-design`, Command Code port, renamed from `design` 2026-08-13 to dodge `ckm:design` name; `/design` command updated), project `.agents/skills/`. `.config/opencode/skills/` removed 2026-08-13 — single root. No AGENTS.md tables — auto-discovery.
- Load: native `skill` tool first; `npx openskills read` fallback (binary not installed).
- **Domain family** (all nested variants, name = parent dir, caveman style):
  - `frontend/` + `frontend-tanstack/` (React+TanStack+Tailwind+Vite, refs/stack-conventions.md)
  - `cli/` + `cli-bun-effect/` (Bun+Effect)
  - `backend/` + `backend-effect-bun/` (Bun+Effect, SQLite; DB folded into backend)
- Routing: `agents-swe` skill step 2 routes frontend/cli/backend → generic + stack variant, per-file matching.
- Wiring: `agents-planner` → system-design/architecture; `agents-designer` → wireframes ownership; `agents-brainstormer` → defers process to superpowers `brainstorming` (persona + read-only subagent constraints + wrap-up format; returns design for parent to persist as spec doc). `agents-planner` defers process to superpowers `writing-plans` (persona + read-only subagent constraints + routing rules; returns plan for parent to persist as docs/superpowers/plans/). `agents-architect` defers process to `system-design` + `architecture` (owns design + ADR; returns both for parent to persist, ADR via docs/adr/ convention). Chain: brainstorming → architect (design + ADR) → planner (writing-plans) → swe.
- YAML gotcha: unquoted frontmatter descriptions with `: ` silently break discovery (killed frontend + effect-ts 2026-08-13; fixed via single-quoted descriptions).
- `~/AGENTS.md` deleted 2026-08-13 (stale catalog; redundant with native `<available_skills>` injection). Not chezmoi-managed.
- `caveman-stats` pruned (Claude Code-only; reads CC session log). Caveman mode now in all 3 harnesses: opencode AGENTS.md, `~/.commandcode/AGENTS.md`, `~/.hermes/SOUL.md` (seeded 2026-08-13).
- Cross-harness scan: opencode/hermes/commandcode recursive; Claude Code/Gemini/Cline/Roo shallow — irrelevant (unused).

## AGENTS.md Sections

Memory (engram: session start → mem_current_project + mem_context; conflicts via mem_judge), Caveman Mode (incl. subagent inheritance: delegation prompts must carry "reply caveman-compressed" line; omo-slim agent prompts embed the mandate), Tool Selection, Codebase Knowledge Graph (codebase-memory-mcp: session-start index check, tool routing table — search_graph/get_code_snippet/trace_path×3/query_graph/search_code/detect_changes, grep fallback rules, delegation qualified_name passing), Agent-Browser, Code Style, Quality, Error Recovery, Quality Gates (agent selection table incl. wireframes→designer, missing-design→planner), Prompt Templates, Commit Rules, Safety, Tool Installation Automation.

## DCP (`dcp.jsonc`)

Range compress, allow, max 50% / min 30% context, nudge 3/10 soft; dedup + purgeErrors(3).

## RTK (CLI proxy)

`~/.local/bin/rtk`, hooks bash via `plugins/rtk.ts` (tool.execute.before → `rtk rewrite`). Failsafe passthrough. Config `~/.config/rtk/config.toml` (machine-local; plugin synced).

## MCP Servers (3)

| Server | Type | Purpose |
|--------|------|---------|
| engram | Go binary `~/go/bin/engram` | Memory: SQLite+FTS5 `~/.engram/engram.db`, agent-only tools. `~/.engram/config.json` pins project_name=`opencode-dotfiles` for home-cwd writes (fixes ambiguous_project from lexa-* worktrees in $HOME; HOME config doesn't leak into repos) |
| playwright | `bun x @playwright/mcp` | Browser automation |
| codebase-memory-mcp | static C binary | Knowledge graph, 14 tools, 66 langs |

## Global Gitignore

Agent files: .opencode/, opencode.json, .cursor*, .claude/, CLAUDE.md, .codex/, AGENTS.md, .gemini/, GEMINI.md, .windsurf/, .engram/, .aider/, .amazonq/.

## OpenCode Go Limits

5h $12 / week $30 / month $60. Est: flash 31.6k req/5h, pro 3.4k, kimi 1.1k.

## Plugins

npm: `@tarquinen/opencode-dcp` + `oh-my-opencode-slim` (re-enabled after 2026-08-13 removal). Local: rtk, engram, background-agents, notify, worktree, kdco-primitives.

## OMO-slim (`oh-my-opencode-slim.json`)

Preset `opencode-go`, all agents on `opencode/x-preview-f-free` (ox-alpha free Zen; variants dropped 2026-08-21 — variant `high` was a reasoning-effort knob, not valid on Zen free models): orchestrator (skills `*`, mcps `* !context7`), oracle (skill simplify), explorer, librarian (mcps context7+gh_grep), designer, fixer. Observer: `opencode/mimo-v2.5-free` (vision-capable). Multiplexer herdr main-vertical.

## GMICloud Preset (`opencode.json`)

Preset `gmicloud` (active by default, `preset: "gmicloud"` in opencode.json). Agent model overrides in `presets.gmicloud`:

| Agent | Model |
|-------|-------|
| swe | `gmicloud/MiniMaxAI/MiniMax-M2.7` |
| planner | `gmicloud/MiniMaxAI/MiniMax-M3#thinking` |
| architect | `gmicloud/MiniMaxAI/MiniMax-M3#thinking` |
| reviewer | `gmicloud/MiniMaxAI/MiniMax-M3#thinking` |
| brainstormer | `gmicloud/MiniMaxAI/MiniMax-M3#thinking` |
| designer-jr | `gmicloud/MiniMaxAI/MiniMax-M3#thinking` |
| explorer-jr | `gmicloud/MiniMaxAI/MiniMax-M3#thinking` |
| librarian-jr | `gmicloud/MiniMaxAI/MiniMax-M3#thinking` |
| vision | `opencode/mimo-v2.5-free` |

Prompt overrides (2026-08-22): `~/.config/opencode/oh-my-opencode-slim/opencode-go/{agent}_append.md` for oracle/explorer/librarian/designer/fixer — caveman mandate appended to bundled prompts (same line as custom agents; observer intentionally exempt — verbatim transcriptions; orchestrator covered by global AGENTS.md). Explorer append also mandates codebase-memory-mcp-first discovery (search_graph/get_code_snippet/trace_path/search_code over grep). Mechanism: plugin checks preset dir first, `{agent}_append.md` appends, `{agent}.md` replaces (avoid); built-in agents reject `prompt` fields in config JSON.

## Design Decisions (recent; full history in git)

- Chose engram over opencode-mem (no API key)
- Agent family + routing skills (2026-08-13): thin agents, thick skills, deny-by-default
- Nested skill dirs: opencode uses dir basename as ID — collisions displace (tested); variants keep unique names
- DB folded into backend (no separate skill); system design → planner, wireframes → designer-jr
- Skills installed globally only; never vendored in repos (gitignore `.agents/`)
- Removed 2026-08-13: Cloudflare MCP×6, Postgres MCP, lexa MCP, commandcode Go-proxy, cloudflared (OMO-slim since re-enabled)
- Default model ox-alpha free (`opencode/x-preview-f-free`) across opencode.json + all OMO-slim agents; observer pinned `opencode/mimo-v2.5-free` (2026-08-21; brief switch to opencode go same day, reverted)
- Removed 2026-09-05: `lexa-swarm` skill (user request; source `config/skills/lexa-swarm` deleted, backup kept at `~/.agents/skills.backup/`)
- Added 2026-09-05: `design-thinking` skill (SKILL.md router + refs/design-thinking.md, design-graph.md, graph-protocol.md, output-format.md; source r17x gist). Single ID; no AGENTS.md rule needed (auto-discovery).
- Added 2026-09-05: `/design-thinking` command (`~/.config/opencode/commands/design-thinking.md`, mirrors `design.md` pattern; loads skill, routes $ARGUMENTS). Global commands dir unmanaged by home-manager — file lives only in ~/.config. Mirrored to beta profile (`~/.config/opencode-beta/opencode/commands/`, used by `o2`).
- Beta only (`o2`, `~/.config/opencode-beta/opencode/opencode.json`, unmanaged): `agents.build.mode=all` so built-in build can run as subagent (built-in default is primary; primary cannot subagent per V2 docs). Main profile untouched.
