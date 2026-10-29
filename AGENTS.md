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
- `~/.omp` is bind-mounted, so `/data/.omp` inside the container IS the host
  directory — same files, same inode. There is no separate container omp
  config: `~/.omp/agent/config.yml` is the single file both instances read,
  which is why the omp model-role drift is one file, not two.
- Timezone is `Asia/Jakarta` (`timezone` in the module). The image ships no
  `/usr/share/zoneinfo`, so the unit binds `pkgs.tzdata` there read-only and
  sets `-e TZ=Asia/Jakarta`. Without the mount, `TZ` only relabels UTC.
- Server name is `Homestation`, set with `docker exec openbot openbot name
  Homestation`. It lives in the `openbot-data` volume
  (`/data/.config/OpenBot/openbot-team-server-v2.json`), so it survives the
  `--rm` container but not `docker volume rm openbot-data`.
- Skills reach container omp through two mounts:
  `~/.agents` → `/data/.agents` (read-only) and `~/projects` at the absolute
  path `${config.home.homeDirectory}/projects`. The second one is required:
  every link in `~/.agents/skills` names an absolute host path
  (`$HOME/projects/dotfiles/config/skills/<name>`), so mounting `~/.agents`
  alone leaves them dangling and omp silently drops those skills. With both
  mounts the container sees the same skill set as the host from the dotfiles
  checkout. Repo stays the source; nothing is copied into the volume.
