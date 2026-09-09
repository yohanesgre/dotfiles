# Package Boundary — Nix vs Pacman vs Manual

> Phase 5 boundary doc. **Updated 2026-09-07: `home.packages` is empty — no nixpkgs packages (user directive). Nix = declarative config only; system + stable CLI via pacman/CachyOS; fast movers via upstream installers.** Verified `main` 34615d7, Nix 2.35.2 daemon, `nix flake check --no-build` passes.

## Policy

- **Nix (home-manager)**: Declarative user environment — dotfiles, symlinks, activation scripts, skills. `home.packages` **empty** (no nixpkgs packages). Pinned via `flake.lock` (`nixpkgs/nixos-unstable`, `home-manager` follows nixpkgs). Install via `home-manager switch --flake .#yohanes@<host>`.
- **pacman / CachyOS repos (`home/modules/pacman`)**: System + stable CLI toolchain (declared list, 17 entries). `pacmanSync` activation runs before `installPackages` on every switch: `pacman -T` → `sudo pacman -S --needed --noconfirm <missing>` (non-blocking on sudo failure). Standalone: `scripts/pacman-sync.sh`.
- **Upstream installer > Pacman (user 2026-08-31)**: If tool provides official installer from its repo (curl|sh, `go install`, `npm`/`cargo`), prefer that over `pacman -S`. Rationale: avoid distro lag, get latest upstream, consistent across CachyOS ↔ laptop. Example: Nix itself via `https://nixos.org/nix/install --daemon` (chosen) not `pacman -S nix`. Pacman kept only for GUI/GPU/kernel-tied packages where no upstream installer fits.
- **Pacman (CachyOS/Arch)**: GUI, GPU drivers, DE, browsers, electron apps, gaming. Not in Nix — avoids nixGL/OpenGL mismatch, avoids duplicating 297 explicit pacman packages.
- **Manual**: Binaries not in nixpkgs (`~/.local/bin` via `go install`). Systemd user units via `home/modules/hermes` (`systemd.user.services`).

`nixGL` deferred — no `hardware.opengl`/`hardware.graphics` in Nix, no GUI packages in `home.packages`.

## CLI — pacman (`home/modules/pacman/default.nix`)

**Since 2026-09-07** the stable CLI toolchain moved out of nixpkgs `home.packages` (previously 14 entries) into a declarative pacman list. Nix still declares *which* packages must exist — pacman provides the binaries.

| Package | Notes |
|---------|-------|
| git | vcs |
| curl | http (upstream installers depend on it) |
| wget | http |
| jq | json |
| ripgrep | search |
| fd | find |
| fzf | fuzzy |
| bat | pager |
| eza | ls |
| zoxide | smart cd (`z <keyword>`) — dipasang duluan, init di zsh ready |
| nodejs | node (pacman current, was nixpkgs nodejs_22) |
| npm | node pkg manager |
| go | Go toolchain — used by `manualInstall` (engram) |
| neovim | editor |
| zsh | login shell (pacman `/usr/bin/zsh`; `forceZshShell` targets it) |
| zsh-theme-powerlevel10k | p10k theme (`/usr/share/zsh-theme-powerlevel10k/…`, out-of-store symlink into oh-my-zsh custom themes) |

`pacmanSync` ordering: `entryBefore ["installPackages"]` — guarantees `go`/`curl` exist before `manualInstall` (engram) and `upstreamInstall` (installers) run.

HM-implicit machinery remains in the profile (`zsh` via `programs.zsh`, man pages, shared-mime-info) — activation internals, not user tools.

Fast-moving tools (bun, codebase-memory-mcp, rtk, herdr) stay upstream-managed,
see `home/modules/upstream/default.nix` (moved out of Nix 2026-09-07 — nixpkgs lag:
bun 1.3.13 vs 1.4.2, rtk 0.45.0 vs v0.48.0; herdr/cbm lose `herdr update` /
`codebase-memory-mcp update` self-update under Nix).

Extra Nix packages pulled implicitly (not allowlist, via modules): `zsh`, `nix-zsh-completions`, `oh-my-zsh`, `shared-mime-info`, `man-db`, etc. — visible in `nix eval .#homeConfigurations."yohanes@desktop".config.home.packages` but owned by `common.nix` imports (`zsh`, `opencode`, …). Migrated 2026-08-31: `codebase-memory-mcp`/`rtk`/`opencode`/`herdr` moved from `home/modules/manual` + `scripts/install-manual.sh` to `home.packages` (nixpkgs unstable) — `engram` stays manual (not in nixpkgs). Removed 2026-08-31: `omp` (oh-my-pi via `inputs.omp`) deleted — unused. **Reverted 2026-09-07**: `bun`/`codebase-memory-mcp`/`rtk`/`herdr` moved back out of `home.packages` to `home/modules/upstream` (official installers) — nixpkgs lag proven (`bun` 1.3.13 vs 1.4.2, `rtk` 0.45.0 vs v0.48.0; `herdr update` + `codebase-memory-mcp update` self-update Nix-blocked). `opencode` stays bun-installed (`home/modules/opencode`, now prefers upstream `~/.bun/bin/bun`).

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
| CLI toolchain (stable list) | pacman | declarative via `home/modules/pacman`, system-native binaries |

## Manual / Chezmoi (auto-installed via Nix activation) + Migrated to Nix

> Auto via `home/modules/manual/default.nix` (`manualInstall`) + `home/modules/upstream/default.nix`
> (`upstreamInstall`) + `home/modules/opencode/default.nix` — each `home.activation.*`
> (`lib.hm.dag.entryAfter ["installPackages"/"writeBoundary"]`) runs on every `home-manager switch`.
> Upstream tools install when missing and **update on every switch** (all steps `|| warn`,
> offline-safe, never blocks switch). Standalone fallback: `bash scripts/install-manual.sh`.

| Tool | Location | Status | Install |
|------|----------|--------|---------|
| `engram` | `~/go/bin/engram` or `~/.local/bin` | **Manual — not in nixpkgs (404)** | `go install github.com/engramhq/engram@latest` (via `manual/default.nix` + `scripts/install-manual.sh`) |
| `bun` | `~/.bun/bin/bun` | **Upstream 2026-09-07** (was nixpkgs, lagged 1.3.13 vs 1.4.2) | `curl -fsSL https://bun.sh/install \| bash` (via `upstream/default.nix`) |
| `codebase-memory-mcp` | `~/.local/bin/codebase-memory-mcp` | **Upstream 2026-09-07** (was nixpkgs 0.10.8) | DeusData `install.sh` (via `upstream/default.nix`); update via `codebase-memory-mcp update` |
| `rtk` | `~/.local/bin/rtk` | **Upstream 2026-09-07** (was nixpkgs 0.45.0, lagged vs v0.48.0) | `rtk-ai/rtk` `install.sh` (via `upstream/default.nix`) |
| `rtk-mcp` | `~/.local/bin/rtk-mcp` | **Manual (unchanged, since 2026-09-06)** | standalone MCP server binary, separate from `rtk` CLI |
| `opencode` | `~/.bun` global | **Bun (unchanged)** | `bun install -g --trust @opencode/cli@beta` (via `opencode/default.nix`) |
| `herdr` | `~/.local/bin/herdr` | **Upstream 2026-09-07** (was nixpkgs 0.8.2; `herdr update` Nix-blocked) | `curl -fsSL https://herdr.dev/install.sh \| sh` (via `upstream/default.nix`) |
| systemd user units | `~/.config/systemd/user/` via `home/modules/hermes` | HM-managed | `systemctl --user daemon-reload` after switch |
| `bun`/`node` shims | pacman `bun` **removed 2026-09-07** (`pacman -R bun`); `nodejs-lts-krypton` stays (node from pacman = policy) | Upstream owns `~/.bun`; `config/zsh/path.zsh` puts Nix/upstream dirs before `/usr/bin` so same-name pacman tools are shadowed | — |
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

# 5b. pacman packages — auto via pacmanSync activation on switch;
#     standalone fallback: bash scripts/pacman-sync.sh

# 6. Upstream binaries — auto via activations on switch (install when missing + update every run):# bun:                curl -fsSL https://bun.sh/install | bash  (update: bun upgrade)
# codebase-memory-mcp: DeusData install.sh                     (update: codebase-memory-mcp update)
# rtk:                rtk-ai/rtk install.sh (re-run = update, pin RTK_VERSION=vX.Y.Z)
# herdr:              curl -fsSL https://herdr.dev/install.sh | sh (update: herdr update)
# opencode:           bun install -g --trust @opencode/cli@beta
# engram:             go install github.com/engramhq/engram@latest
# verify: which bun codebase-memory-mcp rtk herdr opencode engram
# fallback (standalone): bash scripts/install-manual.sh

# 7. Systemd user units (HM-managed via home/modules/hermes)
systemctl --user daemon-reload
systemctl --user status hermes-gateway-yohanes walker elephant cc-proxy --no-pager

# 8. Validate
bash scripts/validate.sh  # if present, else nix flake check
```

`scripts/hm-switch.sh` usage: `bash scripts/hm-switch.sh <desktop|laptop>` — sources `nix-daemon.sh`, validates host, execs `home-manager switch --flake .#yohanes@$HOST -b backup`.

### Why `home.packages` Identical Across Hosts Now

Stubs empty → `nix eval .#homeConfigurations."yohanes@desktop".config.home.packages --apply 'pkgs: map (p: p.pname or p.name ...) pkgs'` and same for `laptop` return identical list (modulo store hash). Expected. Host divergence added later by editing `home/hosts/<host>.nix`.

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
