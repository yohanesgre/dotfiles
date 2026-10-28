{
  config,
  lib,
  pkgs,
  ...
}:
let
  # System + CLI packages from pacman/CachyOS repos (policy 2026-09-07:
  # no nixpkgs packages in the profile — Nix is declarative config only).
  # Single source of truth; mirrored standalone in scripts/pacman-sync.sh.
  pacmanPackages = [
    "git"
    "curl"
    "wget"
    "jq"
    "ripgrep"
    "fd"
    "fzf"
    "bat"
    "eza"
    "zoxide"
    "nodejs"
    "npm"
    "go"
    "neovim"
    "fastfetch"
    "zsh"
    "zsh-theme-powerlevel10k"
  ];

  # AUR packages. `ghostty-nightly-bin` repackages prebuilt ghostty master
  # builds (CI-built from ghostty-org/ghostty on every passing commit), because:
  # - the repos lag: CachyOS/Arch ship `ghostty` 1.3.1 while upstream tagged
  #   v1.4.0 on 2026-10-27, and ghostty publishes no official Linux binaries;
  # - the source package `ghostty-git` does not build here right now: its
  #   prepare() leaves dependency archives where `zig build --system` expects
  #   unpacked packages ("package not found"), and CachyOS glibc (SFrame)
  #   trips the zig linker (AUR comments, verified by two failed builds
  #   2026-10-28).
  # Date-based pkgver, so updates ride a normal `yay -Syu`; the activation
  # below only fills a missing install and never rebuilds anything.
  aurPackages = [ "ghostty-nightly-bin" ];

  # Repo counterparts the AUR package replaces. It ships the same files
  # (conflicts/provides ghostty), so pacman cannot keep both.
  aurConflicts = [
    "ghostty"
    "ghostty-shell-integration"
    "ghostty-terminfo"
  ];
in
{
  # Runs before installPackages so tools (go, curl) exist for later
  # activation steps (upstream installers).
  home.activation.pacmanSync = lib.hm.dag.entryBefore [ "installPackages" ] ''
    set -u
    export PATH="/usr/bin:/bin:$PATH"
    warn() { echo "pacmanSync: $*" >&2; }
    info() { echo "pacmanSync: $*"; }
    PKGS="${lib.concatStringsSep " " pacmanPackages}"

    if ! command -v pacman >/dev/null 2>&1; then
      warn "pacman not found — not a CachyOS/Arch machine? skipping"
      exit 0
    fi

    missing="$(pacman -T $PKGS 2>/dev/null)" || true
    if [ -z "$missing" ]; then
      info "all ${toString (builtins.length pacmanPackages)} declared packages present"
    else
      info "installing missing: $missing"
      # interactive sudo (password prompt if needed); never blocks switch
      sudo pacman -S --needed --noconfirm $missing 2>&1 || warn "pacman failed — run: sudo pacman -S $missing"
    fi

    # AUR packages: yay/paru install these (ghostty-nightly-bin is a prebuilt
    # download, nothing is compiled). Only a missing package invokes the
    # helper, so a switch never rebuilds or reinstalls ghostty; updates ride a
    # normal `yay -Syu` (date-based pkgver).
    AUR_PKGS="${lib.concatStringsSep " " aurPackages}"
    AUR_CONFLICTS="${lib.concatStringsSep " " aurConflicts}"
    aur_missing=""
    for p in $AUR_PKGS; do
      pacman -Qq "$p" >/dev/null 2>&1 || aur_missing="$aur_missing $p"
    done
    if [ -z "$aur_missing" ]; then
      info "all ${toString (builtins.length aurPackages)} AUR packages present (no rebuild — update: yay -Syu)"
    else
      aur_helper="$(command -v yay || command -v paru || true)"
      if [ -z "$aur_helper" ]; then
        warn "no AUR helper (yay/paru) — install manually:$aur_missing"
      else
        # -R without cascade: only the named repo packages go away, no dep sweep.
        aur_present_conflicts="$(pacman -Qq $AUR_CONFLICTS 2>/dev/null | tr '\n' ' ')"
        if [ -n "$aur_present_conflicts" ]; then
          info "removing repo packages replaced by AUR: $aur_present_conflicts"
          sudo pacman -R --noconfirm $aur_present_conflicts 2>&1 \
            || warn "removing $aur_present_conflicts failed — continuing"
        fi
        info "installing AUR:$aur_missing"
        case "$aur_helper" in
          */yay)
            "$aur_helper" -S --needed --noconfirm --answerclean None --answerdiff None --answeredit None $aur_missing 2>&1 \
              || warn "AUR install failed — run: yay -S $aur_missing"
            ;;
          */paru)
            "$aur_helper" -S --needed --noconfirm --skipreview $aur_missing 2>&1 \
              || warn "AUR install failed — run: paru -S $aur_missing"
            ;;
        esac
      fi
    fi
    true
  '';
}
