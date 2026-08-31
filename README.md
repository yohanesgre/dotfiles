# yohanes dotfiles — Nix flake + home-manager

Reproducible dotfiles for **CachyOS `x86_64-linux`** (desktop + `dell-xps13` + `laptop` alias). **Nix flakes + home-manager** primary. Public: https://github.com/yohanesgre/dotfiles

## Quick Start — Clean Machine (no clone)

```bash
# No clone: direct from GitHub flake
sh <(curl -fsLS https://nixos.org/nix/install) --no-daemon  # or --daemon (needs sudo)
source ~/.nix-profile/etc/profile.d/nix.sh
nix run github:nix-community/home-manager -- switch --flake github:yohanesgre/dotfiles#yohanes@dell-xps13 -b backup
# or: nix run github:nix-community/home-manager -- switch --flake github:yohanesgre/dotfiles#yohanes@laptop -b backup
# or: nix run github:nix-community/home-manager -- switch --flake github:yohanesgre/dotfiles#yohanes@desktop -b backup
```

## Quick Start — With Clone (dev)

```bash
# 1. Clone (or bootstrap auto-clones)
git clone https://github.com/yohanesgre/dotfiles.git ~/projects/dotfiles
cd ~/projects/dotfiles

# 2. Bootstrap (one-shot: nopasswd + Nix + hm-switch)
bash scripts/bootstrap.sh --host dell-xps13 --full  # or laptop/desktop, --remote for no-clone
# -> setup-nopasswd-sudo --enable --full + install-nix.sh --no-sudo + hm-switch.sh

# Or manual:
bash scripts/install-nix.sh --no-sudo  # --daemon for multi-user, --no-daemon/--no-sudo for single-user
bash scripts/hm-switch.sh dell-xps13   # auto-detect if no arg, alias laptop->dell-xps13
# -> home-manager switch --flake .#yohanes@dell-xps13 -b backup

# 3. Verify
nix flake check --no-build
bash scripts/validate.sh --ci
```

One-liner bootstrap without local clone (curl):
```bash
curl -fsSL https://raw.githubusercontent.com/yohanesgre/dotfiles/main/scripts/bootstrap.sh | bash -s -- --remote --host dell-xps13 --full
```

Manual binaries auto-install via `home.activation.manualInstall` (`home/modules/manual`):
`engram` skipped (upstream `github.com/engramhq/engram` has no `go.mod`, no installable package). `codebase-memory-mcp`/`rtk`/`opencode`/`herdr` now in `home.packages`.

## Prerequisites

- **Nix 2.35+** with flakes enabled (`experimental-features = nix-command flakes`)
- `git`, `curl`
- CachyOS/Arch `x86_64-linux` (targets `yohanes@desktop` / `yohanes@laptop` / `yohanes@dell-xps13` + alias `yohanes@dell-xps13-cachyos`)

## Structure

```
flake.nix                   # inputs: nixpkgs/nixos-unstable, home-manager
flake.lock                  # pinned
home/common.nix             # username/homeDirectory/stateVersion + imports
home/hosts/desktop.nix      # desktop (imports hermes)
home/hosts/laptop.nix       # laptop/dell-xps13 (shared, minimal)
home/modules/packages.nix   # CLI allowlist (home.packages)
home/modules/manual/        # home.activation.manualInstall — engram stub (skipped)
home/modules/shell/zsh.nix  # zsh (force zsh + p10k + oh-my-zsh, removes tmux plugin)
home/modules/opencode/      # opencode config
home/modules/engram/        # engram
home/modules/skills/        # skills
config/                     # raw configs symlinked via xdg.configFile (zsh/p10k/opencode/hermes/engram/skills)
docs/migration/             # migration notes inc. packages-boundary.md
scripts/bootstrap.sh        # one-shot clean-machine: nopasswd + install-nix + hm-switch (--remote for no-clone)
scripts/install-nix.sh      # Nix installer: --daemon/--no-daemon/--no-sudo toggle + flakes
scripts/setup-nopasswd-sudo.sh  # sudo NOPASSWD toggle: --enable --full/--nix-only, --disable, --toggle
scripts/hm-switch.sh        # switch wrapper: auto host, --remote for github:yohanesgre/dotfiles
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
# Local dev (with clone)
git pull
bash scripts/hm-switch.sh dell-xps13  # or desktop, auto if no arg
nix flake update                    # bump inputs (commits flake.lock)
nix flake check --no-build          # validate

# Clean install without clone (any machine)
bash scripts/bootstrap.sh --remote --host dell-xps13 --full
# or: hm-switch --remote dell-xps13
```

## Validation

```bash
nix flake check --no-build
bash scripts/validate.sh --ci
```
