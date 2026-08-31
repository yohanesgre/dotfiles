# Plan: chezmoi → Nix flakes + home-manager (CachyOS sync)

**Goal:** migrasi full ~/projects/dotfiles dari chezmoi ke flakes + home-manager standalone biar desktop ↔ laptop CachyOS sync reproducible. Nix belum install (/nix missing). Repo dirty 427 modified + 121 untracked. Repo GitHub rename Opencode-Dotfiles → dotfiles (yohanesgre/dotfiles) done per user request 2026-08-31.

**Update 2026-08-31 (user):** pakai Nix upstream dari repo mereka (nixos.org installer --daemon), bukan Determinate. Plan Phase 1 diupdate accordingly.

## Decisions
- Installer: **Official upstream** `sh <(curl -L https://nixos.org/nix/install) --daemon` (canonical, systemd multi-user, manual `experimental-features = nix-command flakes`). Alternatif Arch `pacman -S nix` (extra, v2.35.1-3) valid tapi upstream script chosen per request. Determinate ditolak (hindari downstream fork + telemetry + determinate-nixd).
- GUI/GPU stays pacman: browsers, nvidia/mesa, DE, steam — CLI/dotfiles aja di Nix (hindari nixGL mismatch `/nix/store/...-mesa` vs `/usr/lib/libGL.so`). nixGL optional.
- Skills mutability: `config.lib.file.mkOutOfStoreSymlink` untuk `~/.agents/skills` (~150 skills, `npx openskills install` butuh writable) — jangan read-only `/nix/store`.
- Host split: `home/common.nix` 95% shared + `home/hosts/desktop.nix` + `home/hosts/laptop.nix` minimal override.
- Repo: `git@github.com:yohanesgre/dotfiles.git`

## Phases

### Phase 0: Audit + Backup Dirty (BLOCKS ALL)
- Files: `docs/migration/00-audit.md`, `scripts/backup-dirty.sh`, `~/backups/dotfiles-pre-nix/`
- Steps: `git status --porcelain | wc -l`, `tar -czf ~/backups/dotfiles-pre-nix/dotfiles-$(date +%Y%m%d-%H%M).tar.gz -C ~/projects dotfiles`, `git stash push -m "pre-nix ..." --include-untracked`, `chezmoi diff > chezmoi-diff.patch`, triage 427+121 keep/discard/migrate. Stash pre-rename done 2026-08-31 `pre-rename dirty backup`.
- Done-when: tarball + stash exists, audit doc list triage
- Verify: `ls -lh ~/backups/dotfiles-pre-nix/; git stash list; git status --short | wc -l`

### Phase 1: Nix Bootstrap (UPSTREAM - updated)
- Files: `scripts/nix-install.sh`, `/etc/nix/nix.conf`, `/nix`
- Steps:
  ```bash
  # Primary: official daemon installer (UPSTREAM)
  sh <(curl -L https://nixos.org/nix/install) --daemon
  # verify: /nix + nix-daemon.service
  systemctl status nix-daemon --no-pager | head
  nix --version

  # enable flakes (upstream requires manual)
  sudo mkdir -p /etc/nix
  echo "experimental-features = nix-command flakes" | sudo tee -a /etc/nix/nix.conf
  # user-level fallback: mkdir -p ~/.config/nix && echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf

  # Alternative Arch package (if prefer pacman tracking):
  # sudo pacman -S --needed nix
  # sudo systemctl enable --now nix-daemon.service
  # same flakes enable step above
  ```
  Note: upstream lacks receipt/uninstall like Determinate; uninstall via `sudo rm -rf /nix /etc/nix` + remove init. BTRFS: /nix as dir on BTRFS root, no manual subvolume needed; keep compress=zstd.

- Verify: `nix --version; cat /etc/nix/nix.conf | grep flakes; nix flake --help | head; systemctl status nix-daemon`
- Risk: script fragile vs pacman lag. Mitigasi: BTRFS snapshot `sudo btrfs subvolume snapshot / ...` sebelum install, jangan mix installer.

### Phase 2: Repo Skeleton + Flake
- Files: `flake.nix` (inputs nixpkgs nixos-unstable + home-manager follows), `flake.lock`, `home/common.nix`, `home/hosts/desktop.nix`, `home/hosts/laptop.nix`, `home/modules/packages.nix`, `.gitignore`, `.github/workflows/validate.yml`, `.githooks/pre-commit`
- homeConfigurations: `"yohanes@desktop"` + `"yohanes@laptop"` -> `modules = [ ./home/common.nix ./home/hosts/<host>.nix ]`
- Unpinned clone URLs updated to `yohanesgre/dotfiles`
- Verify: `nix flake check; nix flake show; home-manager build --flake .#yohanes@desktop --dry-run`

### Phase 3: Core Shell (zsh, p10k, engram)
- From: `dot_zshrc.tmpl` 4K (per-OS branch cachyos/darwin -> both CachyOS jadi hapus), `dot_p10k.zsh` 89K, `dot_engram/config.json` (former `dot_config/omp` removed 2026-08-31)
- To: `home/modules/shell/zsh.nix` (`programs.zsh` + `oh-my-zsh` plugins git/fzf/extract/tmux, `initExtraFirst` p10k instant prompt, `initExtra = readFile ../../config/zsh/extra.zsh`), `config/p10k.zsh`, `config/zsh/extra.zsh` (PATH go/bun/local/cargo, aliases ld/dc/dps/bao/rsudo, tmuxhelp fn, gcloud, cachyos-config guard `[[ -f /usr/share/cachyos-zsh-config/cachyos-config.zsh ]]`), engram module via `xdg.configFile` (omp removed)
- Verify: `home-manager switch --flake .#yohanes@desktop -b backup; ls -l ~/.zshrc ~/.p10k.zsh; zsh -ic 'typeset -f tmuxhelp | head'`

### Phase 4: Heavy Dotfiles (opencode, skills 150, hermes, systemd)
- From: `dot_config/opencode/*`, `dot_agents/skills`, `dot_config/hermes/profiles/*`, `dot_config/systemd/user/*`
- To: `home/modules/opencode/default.nix` (`xdg.configFile "opencode/*"` + `home.activation.opencodeBootstrap` bun install), `home.file.".agents/skills".source = mkOutOfStoreSymlink "~/projects/dotfiles/config/skills"`, `home/modules/hermes/default.nix` + `systemd.user.services/timers.hermes-config-sync`
- Verify: `ls -R ~/.config/opencode | head; ls ~/.agents/skills | wc -l` (~150), `systemctl --user status hermes-config-sync.timer`

### Phase 5: Package Boundary
- Files: `home/modules/packages.nix`, `docs/migration/packages-boundary.md`
- Allowlist CLI: git curl wget jq ripgrep fd fzf bat eza zoxide bun nodejs_22 go neovim tmux
- Deny: nvidia/mesa/vulkan/firefox/chromium/code/steam -> pacman own
- Verify: `which git` -> /nix/store, `which firefox` -> pacman, `pacman -Qo $(which firefox)`
- Doc boundary list.

### Phase 6: Host Split + Laptop Bring-up
- Files: `home/hosts/laptop.nix` final, `home/hosts/desktop.nix` minimal
- Steps laptop fresh: `git clone git@github.com:yohanesgre/dotfiles.git ~/projects/dotfiles; bash scripts/nix-install.sh; home-manager switch --flake .#yohanes@laptop -b backup` (clone URL updated)
- Sync test: desktop `git push` flake.lock -> laptop `git pull; home-manager switch --flake .#yohanes@laptop`
- Verify: `nix flake check; home-manager build --flake .#yohanes@desktop; home-manager build --flake .#yohanes@laptop`

### Phase 7: Chezmoi Decommission
- Delete/archive: `.chezmoi.toml.tmpl`, `.chezmoiignore`, `dot_*`, `run_once_after_bootstrap.sh.tmpl`
- Update: `README.md` (Nix quickstart with new `yohanesgre/dotfiles` clone URL), `scripts/validate.sh` (-> `nix flake check`), `scripts/hm-switch.sh` (`HOST=$1 home-manager switch --flake .#yohanes@$HOST -b backup`), `.githooks/pre-commit`
- Steps: `chezmoi managed --path-style=absolute > /tmp/old-managed.txt`, validate Nix covers same paths, `chezmoi purge`, `rm ~/.local/bin/chezmoi` optional
- Verify: `which chezmoi || echo removed; ls ~/.local/share/chezmoi 2>&1; nix flake check`

### Phase 8: Rollback Drill + Docs
- Files: `docs/migration/rollback.md`, `docs/migration/verification.md`
- Rollback: `home-manager generations; home-manager switch --rollback`, restore `tar -xzf ~/backups/...`, `chezmoi init --apply`, upstream uninstall `sudo rm -rf /nix /etc/nix ~/.config/nix; sudo systemctl disable nix-daemon`
- Verify: generation rollback tested

## Global Verification
```bash
nix --version; cat /etc/nix/nix.conf | grep flakes
nix flake check -v; nix flake show
home-manager build --flake .#yohanes@desktop
home-manager build --flake .#yohanes@laptop
home-manager switch --flake .#yohanes@desktop -b backup --dry-run
home-manager generations | head
ls -l ~/.zshrc ~/.p10k.zsh ~/.config/opencode/opencode.json ~/.agents/skills
systemctl --user status hermes-config-sync.timer
```

## Risks (updated)
- Upstream script fragility: download then `less` before exec, never curl|sh blind per ArchWiki
- /nix BTRFS + compress: snapshot before install, single installer only (don't mix Determinate)
- File collision on switch: always `-b backup` + dry-run
- Skills read-only: mkOutOfStoreSymlink
- zsh/p10k tmux break: keep p10k instant prompt order + guard cachyos-config
- Dirty loss 427 files: stash+tar+chezmoi diff before purge (stash exists)
- MCP binaries not in nixpkgs: keep ~/.local/bin + PATH

## Next Action
Commit rename (README + install.sh) + plan update, push to `yohanesgre/dotfiles`, then run Phase 1 upstream install: `sh <(curl -L https://nixos.org/nix/install) --daemon` + enable flakes + `nix run home-manager/master -- init`.
