---
name: lexa-cli
description: >
  Operate a Lexa project-management server from the command line using the
  lexa-cli tool (login with an API key from Settings, check status, list and
  manage tasks, read wiki pages, manage Forge agent runtimes and machines,
  deploy/undeploy a server to Cloudflare, validate GitHub sync, self-upgrade).
  Trigger: "lexa", "lexa-cli", "create a lexa task", "check lexa tasks",
  "restart the forge listener", "lexa runtime list", "lexa machine status",
  "deploy lexa".
---

# lexa-cli — Operate Lexa from the terminal

`lexa-cli` is the operator CLI for a self-hosted Lexa server. It wraps the
Lexa REST API with the same `lxk_` Bearer API keys the web app uses.

## When to use this vs MCP

- **Use MCP** for agent task work (creating/moving tasks, reading/writing
  wiki) when the Lexa MCP server is configured for your agent — it's the
  native agent surface, names over UUIDs, Markdown in/out.
- **Use lexa-cli** for operator/admin work: log in, check server status,
  list/create/move tasks from a shell, start/stop the Forge machine listener
  (the daemon supervisor), list runtimes, deploy/undeploy a server, validate
  GitHub sync, or script Lexa.

## Setup

Two builds, one interface, independent releases:
- **prod** — compiled binary `lexa-cli` on PATH (`bin/lexa-cli` in the repo,
  or `~/.local/bin` after `curl -fsSL .../install-cli.sh | bash`).
  Build: `bun run compile:cli` (embeds the daemon + compose files).
- **dev** — live repo source: `bun run lexa-cli-dev`, or install the shim
  with `bun run install:cli-dev` → `~/.local/bin/lexa-cli-dev` (never
  overwrites the prod name). `bun run uninstall:cli-dev` removes it.

CLI version is independent of the web app version (`cli-v*` tags drive its
GitHub releases; `lexa-cli upgrade` self-updates the binary). Changelog:
`cli/CHANGELOG.md`. Version source of truth: `cli/package.json`.

```bash
# dev (repo), prod binary takes the same commands
bun run lexa-cli-dev login --url http://localhost:3000 --key lxk_...
# or via env for one-shot (flags override saved login):
LEXA_URL=https://lexa.example.com LEXA_API_KEY=lxk_... lexa-cli status
```

The key comes from Lexa → Settings → API Keys, starts with `lxk_`. Login
stores it chmod 600.

### Per-flavor state roots

Each flavor keeps its own state root (config, machine-id, runtimes, Forge
workspaces) — logins do not leak across environments:

| Flavor  | Root                  |
|---------|-----------------------|
| prod    | `~/.lexa/`            |
| staging | `~/.lexa-staging/`    |
| dev     | `~/.lexa-dev/`        |

`LEXA_DIR` env override wins for every flavor. Deploy credentials (Cloudflare
token, Google OAuth client) live under the same root's `config.json` under a
`deploy` key. Legacy `~/.config/lexa-*` state migrates into `~/.lexa`
automatically on first use.

## Common operations

```bash
# Status (server reachable + auth + counts)
lexa-cli status

# Projects
lexa-cli project list [--json]

# Tasks (columns/swimlanes by NAME, case-insensitive)
lexa-cli task list --project emberfall [--limit 20] [--json]
lexa-cli task get <id> --project emberfall [--json]
lexa-cli task create --project emberfall --column "in progress" --swimlane "core" --title "Fix jump bug"
lexa-cli task move <id> --project emberfall --column done [--swimlane core]
lexa-cli task update <id> --project emberfall [--title <t>] [--priority <p>] [--type <t>]

# Wiki
lexa-cli wiki list --project emberfall [--json]
lexa-cli wiki get game-design-doc --project emberfall [--json]

# Forge daemon runtimes (server-side view)
lexa-cli runtime list                     # online/offline per machine
lexa-cli runtime delete <id>              # remove runtime (its machine's
                                          # listener cleans up daemon + env)

# Machine listener (owns the daemon processes)
lexa-cli machine list                     # registered machines
lexa-cli machine install                  # systemd user unit + start (or --no-systemd)
lexa-cli machine listen                   # run the listener in the foreground
lexa-cli machine start | stop | restart   # systemctl --user lexa-machine-listener
lexa-cli machine status                   # systemd state
lexa-cli machine logs                     # follow the listener journal
lexa-cli machine delete <id>              # remove machine + runtimes
lexa-cli machine workspace list           # per-project Forge workspaces locally
lexa-cli machine workspace sync           # re-index projects from server + provision

# Deploy / undeploy (Docker + cloudflared tunnel + Access)
lexa-cli deploy <domain> [staging|prod]   # provision tunnel + Access + deploy
lexa-cli undeploy <domain> [staging|prod] # full teardown
lexa-cli upgrade                          # self-update the CLI binary only

# GitHub sync (optional integration)
lexa-cli github status  [--env-file <path>]   # validate GITHUB_* vars
lexa-cli github setup   [--env-file <path>]   # configure App ID + PEM + webhook secret
lexa-cli github check <slug> <owner/repo>     # acceptance round-trip (creates a real issue)
```

Append `--json` to any list/get command for scriptable output.

## Forge daemon recovery

If a runtime shows **Offline** in `lexa-cli runtime list` (or the web
Settings → Agent Runtimes), the daemon process on that machine stopped.
Restart it:

```bash
# on the daemon machine:
lexa-cli machine restart          # restarts the listener, which respawns
                                  # every runtime's daemon
# or run the listener in the foreground:
lexa-cli machine listen           # requires a saved login (LEXA_URL +
                                  # LEXA_API_KEY env works too)
```

There is no `runtime install/start/status/logs/restart` — those verbs live
on `machine`. New runtimes are created from the web wizard (Settings →
Forge Runtimes → Setup runtime), which posts a setup event the listener
claims; the listener writes the runtime env and spawns the daemon.

After starting, `lexa-cli runtime list` flips back to Online within ~15s
(heartbeat interval). The daemon uses the API key written by the setup
wizard (Bearer auth); an `lxk_` key works in `LXK_FORGE_DAEMON_TOKEN` too
— the daemon detects the prefix and routes it to Bearer.

Daemons never inherit the listener's shell env (closed allowlist scrubs
secrets at spawn); a daemon whose env-file key is dead exits 3 ("API key
revoked — re-run Setup runtime"). Forge host state lives under the flavor
root (`LEXA_DIR`), not the repo.

## Notes

- All commands exit non-zero on error; errors are printed to stderr.
- The CLI only prompts on interactive `login` when stdin is a terminal;
  scripted/piped runs never prompt (missing args = error). Dev flavor
  (source run) defaults the server URL to `http://localhost:3000` when
  Enter is pressed; the compiled prod binary requires an explicit URL.
- `deploy` is remote-only: it embeds the compose files and pulls the image —
  no checkout, no build, no git. Redeploy = upgrade (always pulls latest;
  `--image <tag>` pins; `--clean` wipes the DB volume).
- Run `lexa-cli --help` for the full command reference.
