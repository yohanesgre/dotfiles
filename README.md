# Opencode Dotfiles

Private dotfiles repo — now **Nix flakes + home-manager** (primary) with chezmoi retained for `systemd/hermes-config-sync` only. Contains everything needed to reproduce a fully-configured OpenCode environment: config, plugins, skills, tools, agent rules, MCP servers.

**Two machines**: CachyOS desktop + laptop (Arch-based) — Nix home-manager sync via `yohanes@desktop` / `yohanes@laptop`.

> **Coexistence (Phase 7 partial)**: Nix manages `zsh/p10k/opencode/hermes/engram/skills` via `config/*` + `home/*` (`home-manager switch --flake .#yohanes@desktop -b backup`). chezmoi still manages `dot_config/systemd/user/hermes-config-sync.{service,timer}` (`chezmoi managed` shows 5 entries, `chezmoi status` empty). `.chezmoiignore` now ignores `config/home/flake.*` to avoid collisions (`private_SKILL.md` / `create_*` prefix clashes fixed).

---

## Quick Start (New Machine)

```bash
# 1. Clone the repo anywhere (auto-detected by install script)
git clone git@github.com:yohanesgre/dotfiles.git ~/projects/dotfiles

# 2. Run the installer
bash ~/projects/dotfiles/scripts/install.sh

# 3. If the bootstrap script didn't auto-run, trigger it via chezmoi:
chezmoi state delete-bucket --bucket=entryState && chezmoi apply

# 4. Install OpenCode itself (not managed by chezmoi)
#    Download from https://opencode.ai/download
```

The installer is **idempotent** — safe to re-run. It installs chezmoi, verifies prerequisites, applies the config, and prints a tool availability summary.

---

## Prerequisites

These must be installed manually **before or after** chezmoi — they are not managed by this repo:

| Tool | Install | Why Manual |
|------|---------|------------|
| **chezmoi** | `sh -c "$(curl -fsLS get.chezmoi.io)" -- -b ~/.local/bin` (auto-installed by `scripts/install.sh`) | One-time bootstrap |
| **engram** | `brew install gentleman-programming/tap/engram` or download pre-built binary from [releases](https://github.com/Gentleman-Programming/engram/releases) | Pre-built binary available |
| **codebase-memory-mcp** | `brew install codebase-memory-mcp` or `curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh \| bash` | Pre-built binary available |
| **opencode** | `brew install anomalyco/tap/opencode` or `curl -fsSL https://opencode.ai/install \| bash` | Platform-specific binary |
| **bun** | `curl -fsSL https://bun.sh/install \| bash` | Needs interactive shell |
| **node** | `brew install node` (macOS) / `pacman -S nodejs` (Arch) | No universal installer |
| **rtk** | `brew install rtk` (macOS) / `curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh \| sh` (Linux) | Machine-local binary |

The installer script (`scripts/install.sh`) handles chezmoi + apply automatically, then prints a checklist of what's present and what's missing.

---

## How It Works

### chezmoi + Go Templates

This repo is a [chezmoi](https://chezmoi.io) **source directory**. chezmoi reads files from `~/projects/dotfiles/` and applies them to the home directory, handling:

- **File mapping**: `dot_config/opencode/opencode.json` → `~/.config/opencode/opencode.json`
- **Template rendering**: Files ending in `.tmpl` are processed as Go templates before deployment
- **Run-once scripts**: `run_once_after_bootstrap.sh.tmpl` runs exactly once per machine
- **Ignore rules**: `.chezmoiignore` excludes scripts, gitignore, and README from deployment

### Template Variables

Only 2 files use Go templates — both reference the same variable:

| File | Template Variable | Expands To |
|------|-------------------|------------|
| `opencode.json.tmpl` | `{{ .chezmoi.homeDir }}` | `/home/yohanes` or `/Users/yohanes` |
| `plugins/engram.ts.tmpl` | `{{ .chezmoi.homeDir }}` | `/home/yohanes` or `/Users/yohanes` |

This is how the config references `~/go/bin/engram` and `~/.local/bin/codebase-memory-mcp` correctly on both Linux and macOS. All other files are static.

---

## Repository Structure

```
~/projects/dotfiles/
├── README.md                             ← This file
├── .gitignore                            ← Editor/OS clutter (not deployed)
├── .chezmoiignore                        ← Prevents scripts/README from being deployed
├── run_once_after_bootstrap.sh.tmpl      ← Runs npm/openskills/cloudflare installs once
├── scripts/
│   ├── install.sh                        ← Post-clone installer (run this on new machines)
│   └── uninstall.sh                      ← Safe rollback with backup
└── dot_config/
    └── opencode/
        ├── opencode.json.tmpl            ← Main config: LSP, compaction, MCP servers (3), plugins
        ├── oh-my-opencode-slim.json      ← 7 specialist agents (orchestrator, oracle, council, etc.)
        ├── tui.json                      ← TUI plugins (slim + subagent statusline)
        ├── dcp.jsonc                     ← Dynamic context pruning config
        ├── AGENTS.md                     ← Agent behavior rules for the LLM
        ├── CONFIGURATION.md              ← Full architecture documentation
        ├── package.json                  ← npm: @opencode-ai/plugin, oh-my-opencode-slim, sharp
        ├── dot_gitignore                 ← → ~/.config/opencode/.gitignore (excludes node_modules)
        ├── plugins/
        │   ├── background-agents.ts      ← Background task delegation
        │   ├── engram.ts.tmpl            ← Engram memory integration (templated)
        │   ├── notify.ts                 ← OS notification plugin + notify/ submodules
        │   ├── notify/
        │   │   ├── backend.ts
        │   │   ├── cmux.ts
        │   │   ├── status.ts
        │   │   └── title.ts
        │   ├── rtk.ts                    ← CLI proxy hook (rewrites commands for token savings)
        │   ├── worktree.ts               ← Git worktree management + worktree/ submodules
        │   ├── worktree/
        │   │   ├── launch-context.ts
        │   │   ├── state.ts
        │   │   └── terminal.ts
        │   └── kdco-primitives/          ← Shared utility library (8 files)
        │       ├── index.ts
        │       ├── get-project-id.ts
        │       ├── log-warn.ts
        │       ├── mutex.ts
        │       ├── shell.ts
        │       ├── temp.ts
        │       ├── terminal-detect.ts
        │       ├── types.ts
        │       └── with-timeout.ts
        ├── skills/                       ← Custom skills from oh-my-opencode-slim plugin
        │   ├── simplify/                 ← Code complexity reduction skill
        │   │   ├── SKILL.md
        │   │   ├── README.md
        │   │   └── codemap.md
        │   └── codemap/                  ← Codebase mapping skill
        │       ├── SKILL.md
        │       ├── README.md
        │       ├── codemap.md
        │       └── scripts/
        │           ├── codemap.mjs
        │           └── codemap.test.ts
        └── tools/
            ├── image.py                  ← Python image processing tool
            └── image.ts                  ← TypeScript image processing tool
```

### What's NOT in this repo

| Resource | Location | Reason |
|----------|----------|--------|
| **node_modules/** | `~/.config/opencode/node_modules/` | Generated by `bun install` — gitignored |
| **Skills** | `~/.agents/skills/` (all skills) | Installed by `npx openskills --universal` |
| **Engram data** | `~/.engram/engram.db` | Machine-local memory database |
| **RTK config** | `~/.config/rtk/config.toml` | Machine-local CLI proxy config |
| **RTK history** | `~/.local/share/rtk/history.db` | Machine-local command history |
| **Codebase graph** | `~/.cache/codebase-memory-mcp/` | Per-project code knowledge graphs |
| **Multica** | `~/projects/multica/` | Docker-based, homestation only |
| **OpenClaw** | `~/projects/openclaw/` | Docker-based, homestation only |
| **~/.opencode/** | Runtime directory | Auto-generated, excluded |
| **.ocx/** | Project runtime | Auto-generated per project |

---

## Templated Files (2 total)

### `opencode.json.tmpl` → `~/.config/opencode/opencode.json`

Contains the main OpenCode configuration:
- Compaction settings (auto, prune, 10k token buffer)
- 3 MCP servers (engram, playwright, codebase-memory-mcp)
- 3 npm plugins (oh-my-opencode-slim, subagent-statusline, DCP)
- Disabled built-in agents (using slim specialists instead)

**Template usage**: `{{ .chezmoi.homeDir }}` expands the Go binary path for engram and codebase-memory-mcp.

### `plugins/engram.ts.tmpl` → `~/.config/opencode/plugins/engram.ts`

The Engram memory MCP integration plugin.

**Template usage**: `{{ .chezmoi.homeDir }}` expands the path to the engram MCP server config.

---

## Daily Workflow

```bash
# Pull latest config from GitHub
chezmoi update

# Edit a file
chezmoi edit ~/.config/opencode/AGENTS.md

# Or edit directly + apply
vim ~/.config/opencode/AGENTS.md
chezmoi apply

# Commit and push changes to the repo
cd ~/projects/dotfiles
git add -A
git commit -m "feat: update agent delegation rules"
git push

# Sync to remote machine
ssh homestation 'chezmoi update'
```

### Making Changes — Two Approaches

| Method | Command | When to Use |
|--------|---------|-------------|
| **chezmoi edit** | `chezmoi edit ~/.config/opencode/AGENTS.md` | Opens the source file in the repo directly. Commit + push after. |
| **Edit target + apply** | Edit `~/.config/opencode/AGENTS.md`, then `chezmoi apply` | chezmoi detects changes and updates the source. Then commit + push. |

Either way, always commit and push from `~/projects/dotfiles/` to share changes across machines.

---

## Post-Install Bootstrap

`run_once_after_bootstrap.sh.tmpl` runs exactly once per machine. It handles:

1. **npm packages** — `bun install` (or `npm install` fallback) for `@opencode-ai/plugin`, `oh-my-opencode-slim`, `sharp`
2. **OpenSkills** — `npx openskills` installs Anthropic skills and UI/UX skills to `~/.agents/skills/`
3. **Cloudflare/Vercel skills** — `npx skills add` from skills.sh ecosystem, installed to `~/.agents/skills/`
4. **Config validation** — Parses `opencode.json`, `oh-my-opencode-slim.json`, and `tui.json` to verify valid JSON

### Pre-commit Hook

A pre-commit hook runs `scripts/validate.sh --ci` before every commit. It's auto-installed by the install script (via `git config core.hooksPath .githooks`). To install manually:

```bash
cd ~/projects/dotfiles && git config core.hooksPath .githooks
```

To bypass on an emergency commit (not recommended):

```bash
git commit --no-verify
```

### Safe Update

`scripts/update.sh` wraps `chezmoi update` with validation — pull, validate, apply:

```bash
bash ~/projects/dotfiles/scripts/update.sh
```

Safe for remote machines too:

```bash
ssh <host> 'bash ~/projects/dotfiles/scripts/update.sh'
```

### chezmoi Config

The `.chezmoi.toml.tmpl` template in the repo auto-generates `~/.config/chezmoi/chezmoi.toml` with the correct source directory when you run `chezmoi init --source=~/projects/dotfiles`. The install script handles this automatically.

### Re-Installing Skills Manually

**All skills via `npx openskills`:**
```bash
# Anthropic skills
npx openskills install anthropics/skills -u -y

# UI/UX & design system
npx openskills install nextlevelbuilder/ui-ux-pro-max-skill -u -y
npx openskills install arvindrk/extract-design-system -u -y
```

**Vercel/Cloudflare ecosystem (separate tool):**
```bash
npx skills add cloudflare/skills@agents-sdk cloudflare/skills@cloudflare \
  cloudflare/skills@cloudflare-email-service cloudflare/skills@durable-objects \
  cloudflare/skills@sandbox-sdk cloudflare/skills@web-perf \
  cloudflare/skills@workers-best-practices cloudflare/skills@wrangler \
  vercel-labs/agent-browser@agent-browser vercel-labs/skills@find-skills -g -y
```

To re-run manually (if it failed or you want a fresh install):

```bash
chezmoi state delete-bucket --bucket=entryState && chezmoi apply
```

Or bypass chezmoi and run the template directly (only works if template has no unresolved variables):

```bash
bash ~/projects/dotfiles/run_once_after_bootstrap.sh.tmpl
```

To force chezmoi to run it again:

```bash
chezmoi state delete-bucket --bucket=entryState
chezmoi apply
```

---

## Per-Machine Setup

### Homestation (Arch Linux)

- **Shell**: zsh
- **Package manager**: pacman
- **Docker services**: Multica (agent orchestration) and OpenClaw (WhatsApp/multi-channel gateway)
- **Go path**: `~/go/bin/`
- **Engram**: installed at `~/go/bin/engram` via `go install`

### Laptop (macOS)

- **Shell**: zsh
- **Package manager**: Homebrew
- **Docker services**: Not running (local dev only)
- **Go path**: `~/go/bin/`
- **Engram**: installed at `~/go/bin/engram` via `go install`

### Shared Across Both

All OpenCode config is identical. The only difference is `{{ .chezmoi.homeDir }}` in templates, which chezmoi resolves per-machine.

---

## MCP Servers (3)

| Server | Type | Command | Notes |
|--------|------|---------|-------|
| **engram** | local | `engram mcp --tools=agent` | Persistent memory across sessions |
| **playwright** | local | `bun x @playwright/mcp` | Browser automation, 25+ tools |
| **codebase-memory-mcp** | local | `codebase-memory-mcp` | Code structure graph, 14 tools |

All local servers need their binaries installed separately (see [Prerequisites](#prerequisites)). Postgres and 6× Cloudflare MCP servers were removed 2026-07-26; lexa removed 2026-08-10.

---

## Plugins (5 + shared library)

| Plugin | File | Purpose |
|--------|------|---------|
| **rtk** | `plugins/rtk.ts` | Intercepts shell commands, rewrites for token-efficient output |
| **engram** | `plugins/engram.ts.tmpl` | Engram memory lifecycle integration |
| **background-agents** | `plugins/background-agents.ts` | Delegates tasks to background subagents |
| **notify** | `plugins/notify.ts` + `plugins/notify/` | OS notifications on task completion |
| **worktree** | `plugins/worktree.ts` + `plugins/worktree/` | Git worktree management |
| **kdco-primitives** | `plugins/kdco-primitives/` | Shared utility library used by other plugins |

---

## Skills (71 installed from ecosystem)

All skills are installed from ecosystem tooling — none are manually managed:

### Skill Loader Priority

When the agent loads a skill (via `npx openskills read <name>`), it searches in this order — first match wins:

1. `./.agents/skills/` — project-local universal (per-project overrides)
2. `~/.agents/skills/` — global universal **(most skills live here)**
3. `./.claude/skills/` — project-local Claude
4. `~/.claude/skills/` — global Claude

The Cloudflare/Vercel skills in `~/.agents/skills/` are loaded separately via the `skill` tool (from `~/.agents/.skill-lock.json`).

### Auto-installed by oh-my-opencode-slim plugin — `~/.config/opencode/skills/`
- **simplify** — Code complexity reduction (built-in custom skill)
- **codemap** — Codebase structure mapping (built-in custom skill)
The plugin installs these automatically via its custom skills system.

### Installed via `npx openskills --universal` — `~/.agents/skills/`

**Anthropic OpenSkills (18):**
```bash
npx openskills install anthropics/skills -u -y
```
algorithmic-art, brand-guidelines, canvas-design, claude-api, doc-coauthoring, docx, frontend-design, internal-comms, mcp-builder, pdf, pptx, skill-creator, slack-gif-creator, template, theme-factory, web-artifacts-builder, webapp-testing, xlsx

**UI/UX & design system:**
```bash
npx openskills install nextlevelbuilder/ui-ux-pro-max-skill -u -y
npx openskills install arvindrk/extract-design-system -u -y
```
Installs: ui-ux-pro-max, design-system, extract-design-system, banner-design, brand, design, slides, ui-styling

**Cloudflare/Vercel ecosystem (separate, via `npx skills add`):**
```bash
npx skills add cloudflare/skills@agents-sdk cloudflare/skills@cloudflare \
  cloudflare/skills@cloudflare-email-service cloudflare/skills@durable-objects \
  cloudflare/skills@sandbox-sdk cloudflare/skills@web-perf \
  cloudflare/skills@workers-best-practices cloudflare/skills@wrangler \
  vercel-labs/agent-browser@agent-browser vercel-labs/skills@find-skills -g -y
```

---

## RTK — CLI Proxy for Token Savings

RTK hooks into OpenCode's `tool.execute.before` lifecycle via `plugins/rtk.ts`. Every shell command gets rewritten for compact, token-optimized output:

```
Agent runs:  git status
Plugin intercepts → rtk rewrite "git status"
Executes as:  rtk git status  →  compact output
```

Supports 40+ command rewrites (git, ls, tree, grep, diff, find, docker, npm, curl, etc.). If RTK is not installed or the rewrite fails, the original command passes through unchanged.

**Installation**:
```bash
# macOS/Linux (Homebrew) — easiest on macOS
brew install rtk

# Linux/macOS — quick install to ~/.local/bin
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh

# Cargo (if you have Rust toolchain)
cargo install --git https://github.com/rtk-ai/rtk

# OpenCode integration (plugin already present in this repo as plugins/rtk.ts)
rtk init -g --opencode

# Verify
rtk --version
```

The plugin (`plugins/rtk.ts`) is already in this repo — it activates automatically on OpenCode startup if `rtk` is found in PATH. If the binary isn't installed, the plugin silently no-ops.

---

## Uninstalling

Safe rollback with backup. Removes chezmoi-managed files, optionally removes chezmoi and the dotfiles repo:

```bash
bash ~/projects/dotfiles/scripts/uninstall.sh
```

The script:
1. Asks for confirmation (default: no)
2. Backs up `~/.config/opencode/` to `~/.config/opencode.bak.<timestamp>/`
3. Removes all chezmoi-managed files
4. Cleans up chezmoi state
5. Optionally removes chezmoi binary and the dotfiles repo
6. Prints manual cleanup instructions (node_modules, installed skills, engram data, RTK config)

External tools (engram, codebase-memory-mcp, rtk, node, bun, opencode) are **never** touched.

---

## Troubleshooting

### SSH key not working

```bash
# Check if SSH can reach GitHub
ssh -T git@github.com

# If not, add your key to the agent
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519

# Still failing? The key may not be added to GitHub
cat ~/.ssh/id_ed25519.pub
# → Add at: https://github.com/settings/keys
```

### chezmoi not found after install

```bash
# Ensure ~/.local/bin is in PATH
export PATH="$HOME/.local/bin:$PATH"

# Add to shell config permanently:
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

### Bootstrap script didn't run

```bash
# Force chezmoi to re-run the bootstraps
chezmoi state delete-bucket --bucket=entryState
chezmoi apply
```

### Config changes not taking effect

```bash
# Ensure chezmoi source matches target
chezmoi diff   # Show differences
chezmoi apply  # Apply source to target

# Or if target has changes you want to keep:
chezmoi add ~/.config/opencode/AGENTS.md   # Pull target into source
cd ~/projects/dotfiles && git add -A && git commit -m "..." && git push
```

### OpenCode not picking up new config

Restart OpenCode after applying changes. Config files are read at startup.

### Missing binary errors (engram / codebase-memory-mcp)

These are not installed by chezmoi. Install them manually:

```bash
# engram
go install github.com/engramhq/engram@latest

# codebase-memory-mcp — download from releases to ~/.local/bin/
# See: https://github.com/codebase-memory-mcp/codebase-memory-mcp/releases
```

---

## Security

- **No secrets**: No API keys, tokens, or credentials are stored in this repo
- **Templates are safe**: Only `{{ .chezmoi.homeDir }}` is used — no user data
- **Engram**: Memory database is local (`~/.engram/engram.db`), never synced
- **RTK**: Config and history are machine-local under `~/.config/rtk/` and `~/.local/share/rtk/`
