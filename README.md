# yohanes dotfiles — Nix flake + home-manager

Reproducible dotfiles for CachyOS `x86_64-linux` (desktop + `dell-xps13` + `laptop` alias). Nix flakes + home-manager declare config only; binaries come from pacman/upstream. https://github.com/yohanesgre/dotfiles

## Install

No clone — direct from GitHub flake:

```bash
sh <(curl -fsLS https://nixos.org/nix/install) --no-daemon   # or --daemon (needs sudo)
source ~/.nix-profile/etc/profile.d/nix.sh
nix run github:nix-community/home-manager -- switch --flake github:yohanesgre/dotfiles#yohanes@dell-xps13 -b backup
# hosts: dell-xps13 | laptop | desktop
```

With clone (dev):

```bash
git clone https://github.com/yohanesgre/dotfiles.git ~/projects/dotfiles
cd ~/projects/dotfiles
bash scripts/bootstrap.sh --host dell-xps13 --full   # nopasswd + Nix + switch; add --remote for no-clone
# manual: scripts/install-nix.sh [--no-sudo|--daemon], then scripts/hm-switch.sh dell-xps13
```

Bootstrap one-liner without clone:

```bash
curl -fsSL https://raw.githubusercontent.com/yohanesgre/dotfiles/main/scripts/bootstrap.sh | bash -s -- --remote --host dell-xps13 --full
```

Prereqs: Nix 2.35+ with flakes (`experimental-features = nix-command flakes`), `git`, `curl`.

## Shortcuts

After first switch (`home/modules/shell/zsh.nix`):

```bash
hm           # scripts/hm-switch.sh (auto host)
hm-remote    # scripts/hm-switch.sh --remote (no clone)
hm-check     # nix flake check --no-build
hm-fmt       # nix fmt
hm-validate  # scripts/validate.sh
```

## Layout

```
flake.nix                   # nixpkgs-unstable + home-manager; mkHome (4 homeConfigurations); devShells; nixfmt
home/common.nix             # shared config + imports
home/hosts/{desktop,laptop}.nix   # host overrides (desktop imports hermes)
home/modules/pacman/        # declarative pacman CLI list, synced every switch
home/modules/upstream/      # bun / codegraph / rtk / herdr official installers
home/modules/manual/        # engram (go install)
home/modules/               # env, shell, terminal, opencode, neovim, nix, engram, hermes, skills
                            # nix/ = weekly auto garbage collection (systemd user timer + sudo)
config/                     # raw configs symlinked via xdg.configFile
config/skills/              # committed skills only: local-authored + wired upstream exceptions
config/skills/sources.json  # externalized skill sources (per-project install manifest)
scripts/                    # bootstrap, install-nix, hm-switch, pacman-sync, install-manual,
                            # validate, validate-skills, check-secrets, skills-sync
```

## Package boundary

- **Nix** — declarative config only (dotfiles, symlinks, activation scripts). No nixpkgs CLI packages; `home.packages` empty (policy 2026-09-07). Exceptions: `meslo-lgs-nf` (ghostty), `stdenv.cc.cc.lib` (opencode sharp).
- **pacman/CachyOS** — stable CLI (git/curl/jq/ripgrep/fd/fzf/bat/eza/zoxide/nodejs/npm/go/neovim/zsh/p10k) plus GUI/GPU/DE/browsers/gaming (avoids nixGL mismatch). Declared in `home/modules/pacman`; installed if missing each switch.
- **Upstream > pacman** — if a tool ships `curl|sh`/`go install`/`npm`/`cargo`, prefer it over `pacman -S` (avoids distro lag). Installers run/update every switch.
- **Dev shells** — `nix develop` pins per-project only (`default`: nodejs_22+go, `node24`); nothing global.

## Secrets

`.env.toml` (gitignored) is loaded by `home/modules/env` into the systemd user environment. Never commit secrets; `scripts/check-secrets.sh` guards pre-commit and CI.

## Workflow

```bash
git pull && hm dell-xps13     # switch (auto host if omitted)
hm-check && hm-validate       # flake check + validation suite
nix flake update              # bump inputs (commit flake.lock)
hm-fmt                        # format before commit
```

## Validation

```bash
nix flake check --no-build
nix fmt -- --check flake.nix home/
nix run nixpkgs#deadnix -- -L --fail flake.nix home/
bash scripts/validate.sh --ci   # all above + repo checks + skill validation
```
