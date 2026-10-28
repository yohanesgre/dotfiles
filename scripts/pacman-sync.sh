#!/usr/bin/env bash
# Standalone mirror of home/modules/pacman/default.nix — install the
# declared pacman/CachyOS + AUR packages without running a full hm-switch.
set -u

PKGS=(
  git curl wget jq ripgrep fd fzf bat eza zoxide
  nodejs npm go neovim
  zsh zsh-theme-powerlevel10k
)

# AUR. ghostty-nightly-bin repackages prebuilt ghostty master builds; the repo
# `ghostty` lags upstream and the source package (ghostty-git) does not build
# with zig 0.17 (dependency archives land where --system expects dirs).
AUR_PKGS=(ghostty-nightly-bin)
AUR_CONFLICTS=(ghostty ghostty-shell-integration ghostty-terminfo)

if ! command -v pacman >/dev/null 2>&1; then
  echo "pacman-sync: pacman not found — not a CachyOS/Arch machine" >&2
  exit 1
fi

missing="$(pacman -T "${PKGS[@]}" 2>/dev/null)" || true
if [ -z "$missing" ]; then
  echo "pacman-sync: all ${#PKGS[@]} declared packages present"
else
  echo "pacman-sync: installing missing: $missing"
  # shellcheck disable=SC2086
  sudo pacman -S --needed --noconfirm $missing
fi

aur_missing=()
for pkg in "${AUR_PKGS[@]}"; do
  pacman -Qq "$pkg" >/dev/null 2>&1 || aur_missing+=("$pkg")
done
if [ "${#aur_missing[@]}" -eq 0 ]; then
  echo "pacman-sync: all ${#AUR_PKGS[@]} AUR packages present (no rebuild — update: yay -Syu)"
  exit 0
fi

aur_helper="$(command -v yay || command -v paru || true)"
if [ -z "$aur_helper" ]; then
  echo "pacman-sync: no AUR helper (yay/paru) — install manually: ${aur_missing[*]}" >&2
  exit 1
fi

# -R without cascade: only the named repo packages go away, no dep sweep.
mapfile -t present_conflicts < <(pacman -Qq "${AUR_CONFLICTS[@]}" 2>/dev/null)
if [ "${#present_conflicts[@]}" -gt 0 ]; then
  echo "pacman-sync: removing repo packages replaced by AUR: ${present_conflicts[*]}"
  sudo pacman -R --noconfirm "${present_conflicts[@]}"
fi

echo "pacman-sync: installing AUR: ${aur_missing[*]}"
case "$aur_helper" in
  */yay)
    "$aur_helper" -S --needed --noconfirm --answerclean None --answerdiff None --answeredit None "${aur_missing[@]}"
    ;;
  */paru)
    "$aur_helper" -S --needed --noconfirm --skipreview "${aur_missing[@]}"
    ;;
esac
