#!/usr/bin/env bash
# home-manager switch helper: HOST arg -> home-manager switch --flake .#yohanes@$HOST -b backup
set -euo pipefail

HOST="${1:-}"

if [ -z "$HOST" ]; then
    echo "Usage: $0 <desktop|laptop>" >&2
    echo "Example: $0 desktop  # -> home-manager switch --flake .#yohanes@desktop -b backup" >&2
    exit 1
fi

# shellcheck disable=SC1091
if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
    # shellcheck source=/dev/null
    source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
fi

case "$HOST" in
    desktop|laptop) ;;
    *)
        echo "Unknown host: $HOST (expected desktop or laptop)" >&2
        exit 1
        ;;
esac

FLAKE_REF=".#yohanes@$HOST"

if command -v home-manager >/dev/null 2>&1; then
    HM_CMD=(home-manager)
else
    echo "→ home-manager not in PATH, using nix run fallback" >&2
    HM_CMD=(nix run github:nix-community/home-manager --)
fi

echo "→ ${HM_CMD[*]} switch --flake $FLAKE_REF -b backup"
exec "${HM_CMD[@]}" switch --flake "$FLAKE_REF" -b backup
