# Package Boundary — Nix vs Pacman vs Manual

> Phase 5 boundary doc. Hybrid policy: CLI reproducible via Nix, GUI/GPU stays pacman, manual binaries stay `~/.local/bin`. Verified `main` 34615d7, Nix 2.35.2 daemon, `nix flake check --no-build` passes.

## Policy

- **Nix (home-manager)**: Reproducible CLI toolchain. Pinned via `flake.lock` (`nixpkgs/nixos-unstable`, `home-manager` follows nixpkgs). Install via `home-manager switch --flake .#yohanes@<host>`.
- **Upstream installer > Pacman (user 2026-08-31)**: If tool provides official installer from its repo (curl|sh, `go install`, `npm`/`cargo`), prefer that over `pacman -S`. Rationale: avoid distro lag, get latest upstream, consistent across CachyOS ↔ laptop. Example: Nix itself via `https://nixos.org/nix/install --daemon` (chosen) not `pacman -S nix`. Pacman kept only for GUI/GPU/kernel-tied packages where no upstream installer fits.
- **Pacman (CachyOS/Arch)**: GUI, GPU drivers, DE, browsers, electron apps, gaming. Not in `home.packages` — avoids nixGL/OpenGL mismatch, avoids duplicating 297 explicit pacman packages. Use only when no upstream installer exists or package is system-tied.
- **Manual / chezmoi**: Binaries not in nixpkgs + systemd user units. Kept in `~/.local/bin` + `dot_config/systemd/` via chezmoi until Phase 7 (deferred per user).

`nixGL` deferred — no `hardware.opengl`/`hardware.graphics` in Nix, no GUI packages in `home.packages`.

## CLI — Nix (`home/modules/packages.nix`)

Allowlist = 19 entries, all CLI/headless (verified `grep` shows no GUI string in `home.packages`):

| Package | nixpkgs attr | Notes |
|---------|--------------|-------|
| git | `git` | vcs |
| curl | `curl` | http |
| wget | `wget` | http |
| jq | `jq` | json |
| ripgrep | `ripgrep` | search |
| fd | `fd` | find |
| fzf | `fzf` | fuzzy |
| bat | `bat` | pager |
| eza | `eza` | ls |
| zoxide | `zoxide` | cd |
| bun | `bun` | js runtime (also in `home/modules/opencode` — deduped by Nix) |
| nodejs_22 | `nodejs_22` | node LTS 22 |
| go | `go` | Go 1.27 |
| neovim | `neovim` | editor |
| tmux | `tmux` | multiplexer |
| codebase-memory-mcp | `codebase-memory-mcp` | 0.10.8 — migrated from manual curl (2026-08-31) |
| rtk | `rtk` | 0.45.0 — migrated from manual curl (2026-08-31) |
| opencode | `opencode` | 1.18.21 — migrated from manual curl (2026-08-31) |
| herdr | `herdr` | 0.8.2 — newly added via nixpkgs (2026-08-31, lag 2-3d acceptable) |

Extra Nix packages pulled implicitly (not allowlist, via modules): `zsh`, `nix-zsh-completions`, `oh-my-zsh`, `shared-mime-info`, `man-db`, etc. — visible in `nix eval .#homeConfigurations."yohanes@desktop".config.home.packages` but owned by `common.nix` imports (`zsh`, `opencode`, …). Migrated 2026-08-31: `codebase-memory-mcp`/`rtk`/`opencode`/`herdr` moved from `home/modules/manual` + `scripts/install-manual.sh` to `home.packages` (nixpkgs unstable) — `engram` stays manual (not in nixpkgs). Removed 2026-08-31: `omp` (oh-my-pi via `inputs.omp`) deleted — unused.

`home.packages` grep verification (2026-08-31):

```
# search home/modules/packages.nix for firefox|chromium|brave|code|spotify|steam|alacritty|kitty|wezterm|nvidia|mesa|vulkan
# → only hit = comment line "GUI/GPU stays pacman: browsers, nvidia/mesa, DE, steam — not in Nix (avoid nixGL mismatch)."
# → zero GUI packages in home.packages ✓
```

## GUI/GPU — Pacman (`pacman -Qe`, 297 explicit)

Stays pacman. Evidence `pacman -Qe | grep -E '^(nvidia|mesa|vulkan|firefox|chromium|code|spotify|steam|alacritty|kitty|wezterm|brave)'`:

```
alacritty 0.17.0-1.2
firefox 154.0.1-1.1
mesa-utils 9.0.0-7.1
nvidia-container-toolkit 1.20.0-1.1
nvidia-settings 610.57.04-1
nvidia-utils 610.57.04-1
spotify-launcher 0.6.6-2.1
steam 1.0.0.87-3
vulkan-icd-loader 1.4.357.0-1.1
vulkan-intel 3:26.2.1-1
```

Full explicit list includes additionally (not in grep but pacman-owned, never Nix):

- **Browsers/electron**: `google-chrome 152.0.7977.64`, `helium-browser-bin 0.16.2.1`, `zen-browser-bin 1.21.15b-1`, `visual-studio-code-bin 1.135.0`, `zed 1.17.2`, `obsidian 1.13.7` (`code`/`chromium`/`brave` not installed but policy reserves them to pacman)
- **Terminals/GPU**: `ghostty 1.3.1`, `lib32-nvidia-utils 610.57.04`, `lib32-vulkan-intel`, `intel-media-driver`, `vulkan-intel`, `mesa-utils`
- **DE/Gaming**: `plasma-desktop 6.7.4`, `plasma-*`, `kwallet*`, `sddm`/`plasma-login-manager`, `steam`, `cachyos-gaming-meta`, `linux-cachyos-nvidia-open 7.2.2`
- **Other pacman CLIs intentionally not in Nix** (avoid duplication): `btop`, `fastfetch`, `lazygit`, `github-cli`, `docker`, `yay/paru`, `wl-clipboard` family, etc. — use pacman as source of truth; Nix allowlist is minimal on purpose.

| Category | Package manager | Why |
|----------|-----------------|-----|
| Browsers, electron, IDEs | pacman / AUR | nixGL, sandbox, frequent updates |
| GPU drivers, mesa, vulkan, nvidia | pacman | kernel-tied, `linux-cachyos-nvidia-open` |
| DE, display manager, plasma | pacman | system scope |
| Steam, gaming | pacman | 32-bit + driver coupling |
| CLI toolchain (above allowlist) | Nix | reproducible, pinned |

## Manual / Chezmoi (auto-installed via Nix activation) + Migrated to Nix

> Auto via `home/modules/manual/default.nix` — `home.activation.manualInstall` (`lib.hm.dag.entryAfter ["writeBoundary"]`) runs on every `home-manager switch --flake`. Idempotent (`[ -x ... ]` check), non-blocking (`|| true` + warn), `go` guarded. Standalone fallback: `bash scripts/install-manual.sh`. Migrated tools now in `home.packages` (nixpkgs unstable) — no longer manual.

| Tool | Location | Status | Install |
|------|----------|--------|---------|
| `engram` | `~/go/bin/engram` or `~/.local/bin` | **Manual — not in nixpkgs (404)** | `go install github.com/engramhq/engram@latest` (via `manual/default.nix` + `scripts/install-manual.sh`) |
| `codebase-memory-mcp` | nixpkgs `codebase-memory-mcp` 0.10.8 | **Migrated to Nix 2026-08-31** (was `~/.local/bin/codebase-memory-mcp` curl) | `home.packages` — `nixpkgs#codebase-memory-mcp` |
| `rtk` / `rtk-mcp` | nixpkgs `rtk` 0.45.0 | **Migrated to Nix 2026-08-31** (was `~/.local/bin/rtk` curl) | `home.packages` — `nixpkgs#rtk` |
| `opencode` | nixpkgs `opencode` 1.18.21 | **Migrated to Nix 2026-08-31** (was `~/.opencode/bin` curl) | `home.packages` — `nixpkgs#opencode` |
| `herdr` | nixpkgs `herdr` 0.8.2 | **New via Nix 2026-08-31** (lag 2-3d acceptable) | `home.packages` — `nixpkgs#herdr` |
| systemd user units | `dot_config/systemd/user/` → `~/.config/systemd/user/` via chezmoi | Phase 7 deferred | `chezmoi apply`; `systemctl --user daemon-reload` |
| `bun`/`node` shims | pacman `bun 1.4.0`, `nodejs-lts-krypton 24.19.0` also present system-wide | Nix provides `bun`+`nodejs_22` but pacman copies remain until Phase 7 | — |
| Chezmoi dotfiles | `dot_*`, `dot_config/opencode`, `dot_config/hermes`, `.chezmoiignore` | Purge deferred to Phase 7 | `chezmoi managed` / `chezmoi diff` |

Comment in `packages.nix` now: `# engram not in nixpkgs: kept manual via home/modules/manual (go install).`.

> `omp` (oh-my-pi) — **Removed 2026-08-31**: former `inputs.omp.url = "github:can1357/oh-my-pi"` + `omp.homeManagerModules.default` + `home/modules/omp/default.nix` (`programs.omp`) deleted — unused, DNS npm build failures. Manual fallback `curl https://omp.sh/install | sh` not adopted; reinstall via flake if needed.

## Host Split + Bring-up (Phase 6)

### Layout

```
flake.nix
  homeConfigurations."yohanes@desktop" → [ home/common.nix , home/hosts/desktop.nix ]
  homeConfigurations."yohanes@laptop"  → [ home/common.nix , home/hosts/laptop.nix  ]
home/common.nix  (95% — username, homeDirectory, stateVersion 24.11, imports)
home/hosts/desktop.nix  (stub, 5 lines — comment only)
home/hosts/laptop.nix   (stub, 5 lines — comment only)
home/modules/packages.nix  (allowlist, shared)
```

Stubs intentionally minimal — host overrides go there when needed (e.g., `programs.*.enable` per-host, extra packages). No GUI packages ever added there.

`home/common.nix` imports: `packages.nix`, `shell/zsh.nix`, `opencode`, `hermes`, `engram`, `skills` (former `omp` flake removed 2026-08-31).

### Verification (Nix 2.35.2, 2026-08-31)

```bash
/nix/var/nix/profiles/default/bin/nix --version
# nix (Nix) 2.35.2

/nix/var/nix/profiles/default/bin/nix eval .#homeConfigurations --apply builtins.attrNames
# [ "yohanes@desktop" "yohanes@laptop" ]

/nix/var/nix/profiles/default/bin/nix flake check --no-build
# evaluating flake...
# checking flake output 'homeConfigurations'...
# all checks passed!

# home-manager is flake-provided, not in system PATH — use flake store path + daemon PATH:
PATH="/nix/var/nix/profiles/default/bin:$PATH" \
  /nix/store/4hc09j55m1m4jv665kw1v9cvzyrg7l1l-home-manager/bin/home-manager build --flake .#yohanes@desktop --dry-run
# → 394 news items, no errors, lists 100+ store paths including bat-0.26.1, eza, zoxide-0.10.0, neovim, tmux, go-1.27.0, nodejs-22.22.0, bun-1.4.8, etc.
# EXIT 0

PATH="/nix/var/nix/profiles/default/bin:$PATH" \
  /nix/store/4hc09j55m1m4jv665kw1v9cvzyrg7l1l-home-manager/bin/home-manager build --flake .#yohanes@laptop --dry-run
# → identical store set, EXIT 0 (diff between hosts = zero packages — stubs empty, as intended)
```

`nix` not in default `$PATH` — daemon at `/nix/var/nix/profiles/default/bin/nix` (nix-daemon active, socket at `/nix/var/nix/daemon-socket/socket`). Add `source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh` or `PATH` prepend.

### Laptop Bring-up Procedure

Prereqs: Arch/CachyOS or any Linux with systemd, `git`, `curl`, flakes enabled (`experimental-features = nix-command flakes` in `/etc/nix/nix.conf` or via Determinate installer).

```bash
# 1. Clone
git clone git@github.com:yohanesgre/dotfiles.git ~/projects/dotfiles
cd ~/projects/dotfiles

# 2. Install Nix (if missing) — Determinate or official
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install

# 3. Enable flakes (if installer didn't)
echo 'experimental-features = nix-command flakes' | sudo tee -a /etc/nix/nix.conf

# 4. Verify flake
/nix/var/nix/profiles/default/bin/nix flake check --no-build
/nix/var/nix/profiles/default/bin/nix eval .#homeConfigurations --apply builtins.attrNames
# → [ "yohanes@desktop" "yohanes@laptop" ]

# 5. Switch (laptop) — via helper or direct
bash scripts/hm-switch.sh laptop
# equivalent:
# source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
# home-manager switch --flake .#yohanes@laptop -b backup

# 6. Manual binaries — engram only (others migrated to Nix)
# home.activation.manualInstall (home/modules/manual) runs on switch — engram only:
# engram:       go install github.com/engramhq/engram@latest
# codebase-memory-mcp/rtk/opencode/herdr now via home.packages (nixpkgs); omp removed
# verify: ls ~/go/bin/engram; which codebase-memory-mcp rtk opencode herdr
# fallback (standalone): bash scripts/install-manual.sh  # engram only

# 7. Chezmoi systemd (kept — Phase 7 deferred)
chezmoi apply
systemctl --user daemon-reload
systemctl --user status hermes-gateway-yohanes walker elephant cc-proxy --no-pager

# 8. Validate
bash scripts/validate.sh  # if present, else nix flake check
```

`scripts/hm-switch.sh` usage: `bash scripts/hm-switch.sh <desktop|laptop>` — sources `nix-daemon.sh`, validates host, execs `home-manager switch --flake .#yohanes@$HOST -b backup`.

### Why `home.packages` Identical Across Hosts Now

Stubs empty → `nix eval .#homeConfigurations."yohanes@desktop".config.home.packages --apply 'pkgs: map (p: p.pname or p.name ...) pkgs'` and same for `laptop` return identical list (modulo store hash). Expected. Host divergence added later by editing `home/hosts/<host>.nix`.

## Chezmoi Keep (Phase 7 Deferred)

- `dot_*`, `dot_config/systemd/user/`, `dot_config/hermes/`, `dot_agents/` remain chezmoi-managed.
- `scripts/install.sh` (chezmoi bootstrap) retained — Nix install uses `flake.nix` + `hm-switch.sh`, not `scripts/nix-install.sh` (does not exist; laptop steps above are canonical).
- Do not purge chezmoi until Phase 7. `~/.config/systemd/user/` units (hermes-*, walker, elephant) stay via `chezmoi apply`.

## Commands Reference

```bash
source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
nix flake check --no-build
nix eval .#homeConfigurations --apply builtins.attrNames
home-manager build --flake .#yohanes@desktop --dry-run   # needs nix in PATH
home-manager build --flake .#yohanes@laptop --dry-run
home-manager switch --flake .#yohanes@laptop -b backup
pacman -Qe | sort                          # explicit pacman list (297)
pacman -Qe | grep -E '^(nvidia|mesa|vulkan|firefox|chromium|code|spotify|steam|alacritty|kitty|wezterm|brave)'
grep -R 'firefox\|chromium\|nvidia\|mesa\|vulkan' home/modules/packages.nix  # expect only comment
```
