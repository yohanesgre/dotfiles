#!/usr/bin/env bash
# home-manager switch helper: HOST arg -> home-manager switch --flake .#yohanes@$HOST -b backup
set -euo pipefail

REMOTE=false
ARGS=()
for arg in "$@"; do
    case "$arg" in
        --remote) REMOTE=true ;;
        *) ARGS+=("$arg") ;;
    esac
done
set -- "${ARGS[@]}"
HOST="${1:-}"

# auto-detect if no arg: use hostname, fallback to dell-xps13
if [ -z "$HOST" ]; then
    HOST="$(hostname 2>/dev/null || echo dell-xps13)"
    # normalize: full hostname -> short dell-xps13
    case "$HOST" in
        dell-xps13-cachyos) HOST="dell-xps13" ;;
        dell-xps13*) HOST="dell-xps13" ;;
        desktop|laptop|dell-xps13) ;;
        *) echo "Unknown hostname $HOST, fallback to dell-xps13" >&2; HOST="dell-xps13" ;;
    esac
    echo "→ auto HOST=$HOST (from hostname)" >&2
fi

# alias: laptop <-> dell-xps13 (same config, canonical is dell-xps13) — only for local
if [ "$REMOTE" = false ] && [ "$HOST" = "laptop" ]; then
    HOST="dell-xps13"
    echo "→ alias laptop -> dell-xps13" >&2
fi

# shellcheck disable=SC1091
# Source Nix profile: support both daemon (multi-user) and single-user (--no-daemon / --no-sudo)
for _nix_profile in \
    "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh" \
    "$HOME/.nix-profile/etc/profile.d/nix.sh" \
    "/home/yohanes/.nix-profile/etc/profile.d/nix.sh"; do
    if [ -f "$_nix_profile" ]; then
        # shellcheck source=/dev/null
        source "$_nix_profile"
        break
    fi
done
# Ensure nix bins on PATH for single-user installs
export PATH="$HOME/.nix-profile/bin:/nix/var/nix/profiles/default/bin:$PATH"
unset _nix_profile

case "$HOST" in
    desktop|laptop|dell-xps13|dell-xps13-cachyos) ;;
    *)
        echo "Unknown host: $HOST (expected desktop|laptop|dell-xps13|dell-xps13-cachyos)" >&2
        exit 1
        ;;
esac
# normalize alias dell-xps13-cachyos -> dell-xps13 (canonical short)
if [ "$HOST" = "dell-xps13-cachyos" ]; then
    HOST="dell-xps13"
fi

# Resolve flake ref: local repo vs remote github (no clone)
if [ "$REMOTE" = true ]; then
    FLAKE_REF="github:yohanesgre/dotfiles#yohanes@$HOST"
else
    SCRIPT_SRC="${BASH_SOURCE[0]}"
    if [ -L "$SCRIPT_SRC" ]; then
        SCRIPT_SRC="$(readlink -f "$SCRIPT_SRC" 2>/dev/null || realpath "$SCRIPT_SRC" 2>/dev/null || echo "$SCRIPT_SRC")"
    fi
    SCRIPT_DIR_HM="$(cd "$(dirname "$SCRIPT_SRC")" && pwd)"
    REPO_ROOT="$(cd "$SCRIPT_DIR_HM/.." && pwd)"
    if [ ! -f "$REPO_ROOT/flake.nix" ] && [ -f "$HOME/projects/dotfiles/flake.nix" ]; then
        REPO_ROOT="$HOME/projects/dotfiles"
    fi
    # if no local repo at all, fallback to remote
    if [ ! -f "$REPO_ROOT/flake.nix" ]; then
        echo "→ no local flake.nix, falling back to github:yohanesgre/dotfiles" >&2
        FLAKE_REF="github:yohanesgre/dotfiles#yohanes@$HOST"
    else
        FLAKE_REF="$REPO_ROOT#yohanes@$HOST"
    fi
fi

if command -v home-manager >/dev/null 2>&1; then
    HM_CMD=(home-manager)
else
    echo "→ home-manager not in PATH, using nix run fallback" >&2
    HM_CMD=(nix run github:nix-community/home-manager --)
fi

echo "→ ${HM_CMD[*]} switch --flake $FLAKE_REF -b backup"
exec "${HM_CMD[@]}" switch --flake "$FLAKE_REF" -b backup
