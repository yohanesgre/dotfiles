# yohanes dotfiles — Nix flake + home-manager

Reproducible dotfiles for **CachyOS `x86_64-linux`** (desktop + laptop). **Nix flakes + home-manager** primary. Public: https://github.com/yohanesgre/dotfiles

## Quick Start

```bash
# 1. Install Nix (daemon, multi-user)
sh <(curl -fsLS https://nixos.org/nix/install) --daemon
# then restart shell or: source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh

# 2. Clone
git clone https://github.com/yohanesgre/dotfiles.git ~/projects/dotfiles
cd ~/projects/dotfiles

# 3. Apply (pick host)
bash scripts/hm-switch.sh desktop   # or: laptop
# -> home-manager switch --flake .#yohanes@desktop -b backup

# 4. Verify
nix flake check --no-build
bash scripts/validate.sh --ci
```

Manual binaries auto-install via `home.activation.manualInstall` (`home/modules/manual`):
`engram` (`go install` — not in nixpkgs) stays manual. `codebase-memory-mcp`/`rtk`/`opencode`/`herdr` now in `home.packages`.

## Prerequisites

- **Nix 2.35+** with flakes enabled (daemon install above enables `nix-command` + `flakes`)
- `git`, `curl`
- CachyOS/Arch `x86_64-linux` (targets `yohanes@desktop` / `yohanes@laptop`)

## Structure

```
flake.nix                   # inputs: nixpkgs/nixos-unstable, home-manager
flake.lock                  # pinned
home/common.nix             # username/homeDirectory/stateVersion + imports
home/hosts/desktop.nix      # desktop host overrides
home/hosts/laptop.nix       # laptop host overrides
home/modules/packages.nix   # CLI allowlist (home.packages)
home/modules/manual/        # home.activation.manualInstall — engram fallback
home/modules/shell/zsh.nix  # zsh
home/modules/opencode/      # opencode config
home/modules/engram/        # engram
home/modules/skills/        # skills
config/                     # raw configs symlinked via xdg.configFile (zsh/p10k/opencode/hermes/engram/skills)
docs/migration/             # migration notes inc. packages-boundary.md
scripts/hm-switch.sh        # switch wrapper: nix run home-manager switch --flake .#yohanes@$HOST -b backup
scripts/validate.sh         # repo validation
```

## Package Boundary

Hybrid policy — see [docs/migration/packages-boundary.md](docs/migration/packages-boundary.md):

- **Nix (`home.packages`)** — reproducible CLI toolchain (git/curl/jq/ripgrep/fd/fzf/bat/eza/zoxide/bun/nodejs_22/go/nvim/tmux + `codebase-memory-mcp`/`rtk`/`opencode`/`herdr`)
- **pacman (CachyOS/Arch)** — GUI/GPU/DE/browsers/electron/gaming (firefox, chrome, nvidia/mesa/vulkan, plasma, steam) — avoids nixGL mismatch
- **Upstream installer > pacman** — if tool offers official `curl|sh`/`go install`/`npm`/`cargo`, prefer upstream over `pacman -S` (avoids distro lag)
- GUI packages intentionally absent from `home.packages` (verified `grep -E 'firefox|chromium|nvidia|mesa'` hits only comment)

## Private Data

- `.env.toml` (TOML) — gitignored, loaded via `scripts/load-env.sh`. Never commit secrets.
- `config/private/` — gitignored.
- Optional: `sops-nix` for encrypted secrets (not required).

## No chezmoi

Chezmoi purged — `chezmoi managed` shows 0 entries, `dot_config/` removed, no `run_once_after_bootstrap`. Legacy `.chezmoiignore`/`.chezmoi.toml.tmpl` remain untracked by `home-manager` but do nothing. History squashed public.

## Daily Workflow

```bash
git pull
bash scripts/hm-switch.sh desktop   # apply
nix flake update                    # bump inputs (commits flake.lock)
nix flake check --no-build          # validate
```

## Validation

```bash
nix flake check --no-build
bash scripts/validate.sh --ci
```
