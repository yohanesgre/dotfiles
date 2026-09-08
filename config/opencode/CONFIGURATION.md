# OpenCode Configuration

> Last updated: 2026-09-07 — no pinned `model` (session follows TUI selection, subagents inherit); cli.json syncs `tabs.layout: vertical`
> 2026-09-06 — v2 cleanup (v1 archived, plugins removed except herdr, rtk MCP added, agents V2-native)

## Stack Overview

```
opencode2 (@opencode-ai/cli beta) + OpenCode Go provider ($10/mo)
├── ~/.config/opencode/          → harness config
│   ├── opencode.jsonc           → main config (v2 minimal, home-manager managed)
│   ├── cli.json                 → CLI prefs (managed)
│   ├── AGENTS.md                → agent behavior rules (global, manual sync from dotfiles)
│   ├── CONFIGURATION.md         → this file (managed)
│   ├── agents/*.md              → 9 custom agents, V2 permissions (managed)
│   ├── commands/                → /design-thinking only (manual, unmanaged; /design archived)
│   ├── tools/                   → image.py only (manual, unmanaged; image.ts archived)
│   ├── plugins/                 → herdr-agent-state only (live, unmanaged; rest archived)
│   └── (no skills/ dir — single root `~/.agents/skills/`, restored 2026-09-06)
│   └── MCP (4)                  → engram, playwright, codebase-memory-mcp, rtk
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
  "mcp": {
    "engram": { "command": ["engram", "mcp", "--tools=agent"], "enabled": true, "type": "local" },
    "playwright": { "command": ["bun", "x", "@playwright/mcp"], "enabled": true, "type": "local" },
    "codebase-memory-mcp": { "enabled": true, "type": "local", "command": ["codebase-memory-mcp"] },
    "rtk": { "command": ["rtk-mcp"], "enabled": true, "type": "local" }
  },
  "shell": "/usr/bin/zsh"
}
```

Key: no `plugin` entries (only live-local herdr-agent-state, not in config); no presets/providers (gmicloud removed with v1); built-in build runs `mode: all` so it works as subagent; built-in explore/general enabled (custom explorer-jr/librarian-jr kept alongside); compaction native V2 (`buffer`, no `reserved`/`prune`).

## Agents (`~/projects/dotfiles/config/opencode/agents/*.md`)

All: `mode: all` (vision: subagent), model-agnostic except librarian-jr + explorer-jr (both `model: opencode-go/mimo-v2.5`, cheapest clean quota: 30.1k req/5h, 0 retention), thin shells (identity + guardrails + skill pointer by name), deny-by-default `permissions` ordered rules, `steps` caps. Native V2 frontmatter only (`description`/`mode`/`steps`/`permissions` — legacy top-level `temperature` + V1 `permission` blocks removed 2026-09-06; per V2 docs, request overlays like temperature are not applied by the runner, so effective tuning lives on provider/model/variant). All prompts end with a caveman output mandate: ultra-terse fragments, no filler/narration, substance-only reports; vision keeps transcriptions verbatim.

| Agent | Steps | Guardrails |
|-------|-------|------------|
| swe | 60 | read/glob/grep/list/edit/shell allow; web+question+subagent deny; external_directory `*` allow (all dirs). Skill: `agents-swe` (routing hub) |
| planner | 40 | read-only; web ask; question allow; subagent deny. Skill: `agents-planner` (wraps `writing-plans` process; expects designed input) |
| architect | 40 | read-only; web ask; question allow; subagent deny. Skill: `agents-architect` (wraps `system-design` + `architecture`; owns design + ADR) |
| reviewer | 40 | read-only; shell: git diff/status/log/show allow (bare + `*`), rest ask; subagent deny |
| brainstormer | 30 | read-only; web ask; question allow; subagent deny. Skill: `agents-brainstormer` (wraps `brainstorming` process) |
| designer-jr | 50 | edit+shell allow; web ask; question; subagent deny. Owns wireframes |
| explorer-jr | 30 | read/glob/grep/list only; model `opencode-go/mimo-v2.5` |
| librarian-jr | 40 | read tools + webfetch/websearch allow; no bash; model `opencode-go/mimo-v2.5` |
| vision | 10 | read only; model `opencode-go/mimo-v2.5` (unverified vision; fallback `deepseek-v4-flash-vision-exp`) |

## Skills System (2026-08-13 overhaul)

- Discovery: dirs only, recursive. `~/.agents/skills/` (canonical, single root since 2026-09-06 — `config/opencode/skills/` deleted, no `skills` mapping in default.nix), project `.agents/skills/`. Live `~/.config/opencode/skills/` is an empty leftover dir. No AGENTS.md tables — auto-discovery.
- Load: native `skill` tool first; `npx openskills read` fallback.
- **Domain family** (all nested variants, name = parent dir, caveman style):
  - `frontend/` + `frontend-tanstack/` (React+TanStack+Tailwind+Vite, refs/stack-conventions.md)
  - `cli/` + `cli-bun-effect/` (Bun+Effect)
  - `backend/` + `backend-effect-bun/` (Bun+Effect, SQLite; DB folded into backend)
- Routing: `agents-swe` skill step 2 routes frontend/cli/backend → generic + stack variant, per-file matching.
- Wiring: `agents-planner` → system-design/architecture; `agents-designer` → wireframes ownership; `agents-brainstormer` → defers process to superpowers `brainstorming` (persona + read-only subagent constraints + wrap-up format; returns design for parent to persist as spec doc). `agents-planner` defers process to superpowers `writing-plans` (persona + read-only subagent constraints + routing rules; returns plan for parent to persist as docs/superpowers/plans/). `agents-architect` defers process to `system-design` + `architecture` (owns design + ADR; returns both for parent to persist, ADR via docs/adr/ convention). Chain: brainstorming → architect (design + ADR) → planner (writing-plans) → swe.
- YAML gotcha: unquoted frontmatter descriptions with `: ` silently break discovery (killed frontend + effect-ts 2026-08-13; fixed via single-quoted descriptions).
- `~/AGENTS.md` deleted 2026-08-13 (stale catalog; redundant with native `<available_skills>` injection). Not chezmoi-managed.
- Caveman mode now in all 3 harnesses: opencode AGENTS.md, `~/.commandcode/AGENTS.md`, `~/.hermes/SOUL.md` (seeded 2026-08-13).
- Cross-harness scan: opencode/hermes/commandcode recursive; Claude Code/Gemini/Cline/Roo shallow — irrelevant (unused).

## AGENTS.md Sections

Memory (engram: session start → mem_current_project + mem_context; conflicts via mem_judge), Caveman Mode (incl. subagent inheritance: delegation prompts must carry "reply caveman-compressed" line; custom agent prompts embed the mandate), Tool Selection (incl. rtk preference), Codebase Knowledge Graph (codebase-memory-mcp: session-start index check, tool routing table — search_graph/get_code_snippet/trace_path×3/query_graph/search_code/detect_changes, grep fallback rules, delegation qualified_name passing), Agent-Browser, Code Style, Quality, Error Recovery, Quality Gates (agent selection table incl. wireframes→designer-jr, design/ADR→architect), Prompt Templates, Commit Rules, Safety, Tool Installation Automation.

## DCP (`dcp.jsonc` — archived 2026-09-06)

Removed with the plugin purge. Upstream DCP slowed (focus moved to Sleev), V1-only (V2 breaks all V1 plugins), and our copy referenced stale V1 tool names. V2 native compaction (`buffer: 10000` in opencode.jsonc) covers the basics. File archived at `~/.config/opencode-archive-v1-20260906/dcp.jsonc`; mapping dropped from default.nix. Revisit if a V2-compatible DCP/Sleev integration appears.

## MCP Servers (4)

| Server | Type | Purpose |
|--------|------|---------|
| engram | Go binary `~/go/bin/engram` | Memory: SQLite+FTS5 `~/.engram/engram.db`, agent-only tools. `~/.engram/config.json` pins project_name=`opencode-dotfiles` for home-cwd writes (fixes ambiguous_project from lexa-* worktrees in $HOME; HOME config doesn't leak into repos) |
| playwright | `bun x @playwright/mcp` | Browser automation |
| codebase-memory-mcp | static C binary | Knowledge graph, 14 tools, 66 langs |
| rtk | `~/.local/bin/rtk-mcp` (added 2026-09-06) | Token-optimized shell via `run_command` (allowlisted cmds, 60-90% savings). AGENTS.md Tool Selection: prefer `rtk` prefix / `run_command`, raw shell only when rtk lacks the command. Auto-rewrite plugin deferred (V2 plugin API unstable) |


Removed with v1 2026-09-06: `context7`, `grep_app`, `websearch` (remote MCPs from old `opencode.json`).

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

- `opencode-subagents` (added 2026-09-07, dotfiles-managed via `opencodeSyncPlugins` home-manager activation in `home/modules/opencode/default.nix` — copied as real files from `config/opencode/plugins/opencode-subagents/` into `~/.config/opencode/plugins/opencode-subagents/` on every switch, with `bun install` when node_modules missing; real files required because bun resolves imports from file realpath, so nix-store symlinks would never see node_modules): V2 TUI plugin — sidebar section listing live subagents (child sessions) of the current session. Source: `config/opencode/plugins/opencode-subagents/` (index.ts server stub, tui.tsx slot wiring, types.ts contract, useSubagents.tsx data, SubagentSection.tsx tree, variants.ts V states). Slot `append: "sidebar.content"`; live via `data.listen` + 2s poll; header click toggles collapse (mouse toggle verified only for layout, synthetic-pty mouse never reaches slot content — real-terminal click untested). One line per subagent (agent, status, model/provider, elapsed, tokens) + title/model line — no expand/border (see gotcha). Gotchas (verified empirically 2026-09-07, opencode2 beta-19242, sandbox fake-HOME + `--server` attach):
1. TUI plugin runtime loader only aliases `solid-js`/`solid-js/store` for `.tsx` files — bare `solid-js` imports in `.ts` files fail with `Cannot find package 'solid-js'` at load. Any plugin file importing solid must use `.tsx` (JSX not required).
2. A `box` with `border`/`title` props inside a TUI slot FREEZES the whole renderer at first paint (no crash log, blank screen). Never use border/title in slot content — plain `box` + `text` is fine (signals/timers render normally). Also in the REAL TUI sidebar, flex spacers (`flexGrow`) inside slot rows collapse — children render sequentially with no gap and overflow wraps. Every slot line must be ONE space-padded string per text node; content width measured = 37 cols (pane inset 2 left, ends col 77 on 80-col terminal). Host visual language (measured from ANSI frames): label bold `text.default` at col 41, items `• name` (bullet U+2022, success-green), right meta muted, blank line between sections.
3. TUI plugins are not logged by the plugin loader; failures show only as an in-TUI banner. To debug headless: run `opencode2 serve --port <p>` in a fake HOME, create a session via its OpenAPI (`POST /api/session`, basic auth `opencode:<password from serve log>`), then `opencode2 --server http://127.0.0.1:<p> -s <ses_id>` in a pty.
- `herdr-agent-state` (restored 2026-09-06 from beta profile, V2-native TUI pane reporter; live only, not in dotfiles). Everything else removed 2026-09-06, pending rebuild.
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

- 2026-09-06: v2 migration — archived v1 (opencode.json, omo-slim, gmicloud preset/provider, remote MCPs), removed plugins (herdr-agent-state restored from beta profile), deleted beta profile + `o2` wrapper, main profile minimal + shell/lsp/compaction/playwright. Custom agents migrated to native V2 (temperature + V1 permission blocks dropped, model-agnostic). Skills back to single root (`config/skills/` canonical, incl. rescued `reflect`). rtk MCP added (`run_command`; auto-rewrite plugin deferred). engram 1.15.7→1.20.0. default.nix activations rewritten for `@opencode-ai/cli@beta`. Compaction migrated to native V2 (`buffer`, dropped ignored `reserved`/`prune`).
- Removed 2026-09-05: `lexa-swarm` skill (user request; source `config/skills/lexa-swarm` deleted, backup kept at `~/.agents/skills.backup/`)
- Added 2026-09-05: `design-thinking` skill (SKILL.md router + refs/design-thinking.md, design-graph.md, graph-protocol.md, output-format.md; source r17x gist). Single ID; no AGENTS.md rule needed (auto-discovery).
- Added 2026-09-05: `/design-thinking` command (`~/.config/opencode/commands/design-thinking.md`, mirrors `design.md` pattern; loads skill, routes $ARGUMENTS). Global commands dir unmanaged by home-manager — file lives only in ~/.config.
- Chose engram over opencode-mem (no API key)
- Agent family + routing skills (2026-08-13): thin agents, thick skills, deny-by-default
- Nested skill dirs: opencode uses dir basename as ID — collisions displace (tested); variants keep unique names
- DB folded into backend (no separate skill); system design → planner, wireframes → designer-jr
- Skills installed globally only; never vendored in repos (gitignore `.agents/`)
- Removed 2026-08-13: Cloudflare MCP×6, Postgres MCP, lexa MCP, commandcode Go-proxy, cloudflared
