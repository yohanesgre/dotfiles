# yohanes dotfiles — Nix flake + home-manager

Reproducible dotfiles for **CachyOS `x86_64-linux`** (desktop + `dell-xps13` + `laptop` alias). **Nix flakes + home-manager** primary. Public: https://github.com/yohanesgre/dotfiles

## Quick Start — Clean Machine (no clone)

```bash
# No clone: direct from GitHub flake
sh <(curl -fsLS https://nixos.org/nix/install) --no-daemon  # or --daemon (needs sudo)
source ~/.nix-profile/etc/profile.d/nix.sh
nix run github:nix-community/home-manager -- switch --flake github:yohanesgre/dotfiles#yohanes@dell-xps13 -b backup
# or: ...#yohanes@laptop / ...#yohanes@desktop -b backup
```

## Quick Start — With Clone (dev)

```bash
git clone https://github.com/yohanesgre/dotfiles.git ~/projects/dotfiles
cd ~/projects/dotfiles

# One-shot: nopasswd + Nix + hm-switch
bash scripts/bootstrap.sh --host dell-xps13 --full  # or laptop/desktop, --remote for no-clone

# Or manual:
bash scripts/install-nix.sh --no-sudo  # --daemon for multi-user, --no-daemon/--no-sudo for single-user
bash scripts/hm-switch.sh dell-xps13   # auto-detect if no arg, alias laptop->dell-xps13
# -> home-manager switch --flake .#yohanes@dell-xps13 -b backup

# Verify
nix flake check --no-build
bash scripts/validate.sh --ci
```

One-liner bootstrap without local clone (curl):
```bash
curl -fsSL https://raw.githubusercontent.com/yohanesgre/dotfiles/main/scripts/bootstrap.sh | bash -s -- --remote --host dell-xps13 --full
```

Manual binaries auto-install + auto-update via activations (`manualInstall`, `upstreamInstall`, opencode):
`engram` (`go install`), `bun`/`codebase-memory-mcp`/`rtk`/`herdr` (official installers, update every switch), `opencode` (`bun add -g`).

## Shell Shortcuts (after first switch)

`home/modules/shell/zsh.nix` defines these aliases:

```bash
hm           # ~/projects/dotfiles/scripts/hm-switch.sh (auto host)
hm-remote    # hm-switch.sh --remote (github:yohanesgre/dotfiles, no clone)
hm-check     # nix flake check --no-build
hm-fmt       # nix fmt
hm-validate  # bash ~/projects/dotfiles/scripts/validate.sh
```

## Prerequisites

- **Nix 2.35+** with flakes enabled (`experimental-features = nix-command flakes`)
- `git`, `curl`
- CachyOS/Arch `x86_64-linux` (targets `yohanes@desktop` / `yohanes@laptop` / `yohanes@dell-xps13` + alias `yohanes@dell-xps13-cachyos`)
- Formatter/linter need no extra installs: `nixfmt` via `formatter` flake output, `deadnix` via `nix run nixpkgs#deadnix`

## Structure

```
flake.nix                   # inputs: nixpkgs/nixos-unstable, home-manager
                            # mkHome helper (dedupes 4 homeConfigurations)
                            # devShells: default (nodejs_22+go), node24 (ephemeral pins)
                            # formatter: nixfmt
flake.lock                  # pinned
home/common.nix             # username/homeDirectory/stateVersion + imports
home/hosts/desktop.nix      # desktop (imports hermes module)
home/hosts/laptop.nix       # laptop/dell-xps13 (shared, minimal)
home/modules/packages.nix   # home.packages — intentionally empty (no nixpkgs packages)
home/modules/pacman/        # declarative pacman/CachyOS package list (pacmanSync activation)
home/modules/upstream/      # fast movers via official installers (bun/cbm/rtk/herdr)
home/modules/manual/        # home.activation.manualInstall — engram via go install
home/modules/shell/zsh.nix  # zsh (p10k + oh-my-zsh) + hm* aliases
home/modules/opencode/      # opencode config
home/modules/neovim/        # LazyVim — config/nvim (out-of-store symlink), pacman neovim binary
home/modules/engram/        # engram
home/modules/skills/        # skills wiring
config/skills/nix/          # nix skill (r17x/universe version: root + debug/flake/module/service)
config/                     # raw configs symlinked via xdg.configFile (zsh/p10k/opencode/hermes/engram/skills)
docs/migration/             # migration notes inc. packages-boundary.md
scripts/bootstrap.sh        # one-shot clean-machine: nopasswd + install-nix + hm-switch (--remote for no-clone)
scripts/install-nix.sh      # Nix installer: --daemon/--no-daemon/--no-sudo toggle + flakes
scripts/setup-nopasswd-sudo.sh  # sudo NOPASSWD toggle: --enable --full/--nix-only, --disable, --toggle
scripts/hm-switch.sh        # switch wrapper: auto host, --remote for github:yohanesgre/dotfiles
scripts/validate.sh         # repo validation (Check 1b: flake check + fmt + deadnix)
scripts/pacman-sync.sh      # standalone pacman list sync (mirrors pacmanSync activation)
```

## Package Boundary

Hybrid policy — see [docs/migration/packages-boundary.md](docs/migration/packages-boundary.md):

- **Nix** — declarative config only: dotfiles, symlinks, activation scripts. `home.packages` is **empty** (no nixpkgs packages, policy 2026-09-07)
- **pacman/CachyOS (`home/modules/pacman`)** — system + stable CLI (git/curl/wget/jq/ripgrep/fd/fzf/bat/eza/zoxide/nodejs/npm/go/neovim/zsh/p10k). Declarative list, `pacman -T` check + install missing on every switch. Standalone: `scripts/pacman-sync.sh`
- **Upstream installer (`home/modules/upstream` + `opencode` + `manual`)** — fast-moving tools, install when missing + update every switch (bun/codebase-memory-mcp/rtk/herdr/opencode/engram)
- **pacman (CachyOS/Arch)** — GUI/GPU/DE/browsers/electron/gaming (firefox, chrome, nvidia/mesa/vulkan, plasma, steam) — avoids nixGL mismatch
- **Upstream installer > pacman** — if tool offers official `curl|sh`/`go install`/`npm`/`cargo`, prefer upstream over `pacman -S` (avoids distro lag)
- **Dev shells (`nix develop`)** — per-project ephemeral pins only (see below). Never global packages
- GUI packages intentionally absent from `home.packages`

## Dev Shells (ephemeral, per-project)

Nix provides version pins for project work only. System defaults stay pacman.

```bash
nix develop                    # default: nodejs_22 + go
nix develop .#node24 --command node --version
```

`home.packages` stays empty — shells leave no trace after exit.

## Private Data

- `.env.toml` (TOML) — gitignored, loaded via `scripts/load-env.sh`. Never commit secrets.
- Optional: `sops-nix` for encrypted secrets (not required).

## Daily Workflow

```bash
# Local dev (with clone)
git pull
hm dell-xps13               # or desktop, auto if no arg
hm-check && hm-validate
nix flake update            # bump inputs (commits flake.lock)

# Format before commit
hm-fmt

# Clean install without clone (any machine)
bash scripts/bootstrap.sh --remote --host dell-xps13 --full
# or: hm-remote dell-xps13
```

## Validation

```bash
nix flake check --no-build
nix fmt -- --check flake.nix home/
nix run nixpkgs#deadnix -- -L --fail flake.nix home/
bash scripts/validate.sh --ci   # runs all above as Check 1b + repo checks
```
