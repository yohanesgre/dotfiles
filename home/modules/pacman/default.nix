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
    "zsh"
    "zsh-theme-powerlevel10k"
  ];
in
{
  # Runs before installPackages so tools (go, curl) exist for later
  # activation steps (manualInstall go install, upstream installers).
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
    true
  '';
}
