#!/usr/bin/env bash
# Standalone mirror of home/modules/pacman/default.nix — install the
# declared pacman/CachyOS packages without running a full hm-switch.
set -u

PKGS=(
  git curl wget jq ripgrep fd fzf bat eza zoxide
  nodejs npm go neovim
  zsh zsh-theme-powerlevel10k
)

if ! command -v pacman >/dev/null 2>&1; then
  echo "pacman-sync: pacman not found — not a CachyOS/Arch machine" >&2
  exit 1
fi

missing="$(pacman -T "${PKGS[@]}" 2>/dev/null)" || true
if [ -z "$missing" ]; then
  echo "pacman-sync: all ${#PKGS[@]} declared packages present"
  exit 0
fi

echo "pacman-sync: installing missing: $missing"
# shellcheck disable=SC2086
sudo pacman -S --needed --noconfirm $missing
