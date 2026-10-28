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

## OpenBot Docker server

Self-hosted OpenBot server as a Nix-managed Docker container in
`home/modules/openbot`.

- Unit: `openbot.service` (systemd user, linger already on). The image is
  `ghcr.io/nightly-labs/openbot:0.52.1`; bump `version` and the seccomp hash
  together in the module.
- The host Docker daemon comes from pacman; the unit uses
  `pkgs.docker-client` only. No port is published: the container connects out
  to the account server and providers. Use the desktop/phone app or
  `openbot.run/app`.
- Data is the named volume `openbot-data` mounted at `/data`; it contains the
  session, provider sign-ins, keyring, agents, and conversations. Back it up
  by stopping the unit and copying the volume.
- Login and phone pairing are interactive inside the container:
  `docker exec -it openbot openbot login`, then
  `docker exec -it openbot openbot mobile-connect`. Status:
  `docker exec openbot openbot status`.
- The container is removed on stop (`--rm`), the volume persists. Removal:
  drop the import + module, `home-manager switch`, then
  `docker volume rm openbot-data`.
- Host omp is a CLI wrapper at `/usr/local/bin/omp`, not an ACP provider.
  The unit mounts `~/.bun` read-only, `~/.omp` read-write, and `~/projects`
  at `/data/projects`. OpenBot agents keep their OpenCode/DeepSeek provider
  and run `omp -p ...` under `/data/projects`. Do not mount `~/.pi`: that makes
  the managed Pi runtime exit (1).
