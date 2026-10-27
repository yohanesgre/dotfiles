# AGENTS.md — dotfiles repo

Repo-level notes for coding agents. OpenCode-specific rules (tool calling,
output compression, delegation, codegraph/jg routing) live in
`config/opencode/AGENTS.md`.

## Secrets and `.env.toml`

- `.env.toml` (repo root, gitignored) holds every real secret. Agents MUST NOT
  read, grep, print, diff, or commit its contents.
- When a change needs an env var, update `.env.toml.example` with a placeholder
  and document the variable there. The user fills `.env.toml`.
- Never copy a real value into the repo, a Nix store path, logs, AGENTS.md,
  chat, or a service unit. Reference the variable or file path instead.
- `.env.toml` is loaded into the systemd user environment by
  `home/modules/env` and sourced by `config/zsh/extra.zsh`.

## Paseo daemon

Local coding-agent control plane, Nix-managed in `home/modules/paseo`.

- Units: `paseo.service` (daemon, `127.0.0.1:6767`) and `paseo-tunnel.service`
  (`cf tunnels run paseo`).
- Public URL: `https://paseo.yohanesgre.com`; Cloudflare tunnel
  `7df182c4-9b53-4b03-85d8-922ae5a98f30`, proxied CNAME.
- Auth: `Authorization: Bearer $PASEO_PASSWORD` on `/api/*` and WebSocket.
  `/api/health` is public. Host allowlist is `PASEO_HOSTNAMES=paseo.yohanesgre.com`.
- Secret source: `PASEO_PASSWORD` in `.env.toml` (gitignored), mirrored to
  `~/.config/paseo/paseo.env` (0600) for the unit's `EnvironmentFile`. Never
  read/print the value, never put it in `.env.toml.example`, AGENTS.md, logs,
  commits, or the Nix store.
- Mobile: add host `https://paseo.yohanesgre.com` + password. The daemon is
  0.12.0 while the app is 0.13.2; only a version badge is shown, the connection
  still works.
- Removal: drop `home/modules/paseo` + `paseo-tunnel`, `scripts/hm-switch.sh`,
  `nix-collect-garbage -d`; delete `~/.paseo`/`~/.config/paseo`; delete the
  tunnel and CNAME in Cloudflare.
