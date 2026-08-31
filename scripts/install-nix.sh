#!/usr/bin/env bash
# install-nix.sh — Nix installer with daemon/no-daemon toggle
# Usage:
#   bash scripts/install-nix.sh              # auto: daemon if sudo -n true else no-daemon
#   bash scripts/install-nix.sh --daemon     # force daemon (requires sudo)
#   bash scripts/install-nix.sh --no-daemon  # force single-user, no sudo needed
#   bash scripts/install-nix.sh --no-sudo    # alias for --no-daemon
#   bash scripts/install-nix.sh --yes        # non-interactive (passes --no-modify-profile if needed)
set -euo pipefail

SCRIPT_SRC="${BASH_SOURCE[0]}"
# resolve symlink (for ~/.local/bin/* -> scripts/*)
if [ -L "$SCRIPT_SRC" ]; then
    SCRIPT_SRC="$(readlink -f "$SCRIPT_SRC" 2>/dev/null || realpath "$SCRIPT_SRC" 2>/dev/null || echo "$SCRIPT_SRC")"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SRC")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

MODE="auto"
EXTRA_ARGS=()

for arg in "$@"; do
    case "$arg" in
        --daemon) MODE="daemon" ;;
        --no-daemon|--no-sudo) MODE="no-daemon" ;;
        --yes|-y) EXTRA_ARGS+=("--no-modify-profile") ;;
        --help|-h)
            echo "Usage: $0 [--daemon|--no-daemon|--no-sudo] [--yes]"
            echo ""
            echo "  --daemon     Multi-user (requires sudo, recommended for CachyOS)"
            echo "  --no-daemon  Single-user, no sudo (~/.nix-profile)"
            echo "  --no-sudo    Alias for --no-daemon"
            echo "  --yes        Non-interactive"
            exit 0
            ;;
        *) echo "Unknown arg: $arg" >&2; exit 1 ;;
    esac
done

# already installed?
if command -v nix >/dev/null 2>&1 || [ -e /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ] || [ -e "$HOME/.nix-profile/etc/profile.d/nix.sh" ]; then
    echo -e "${YELLOW}→ Nix already installed${NC}"
    nix --version 2>&1 || true
    # ensure flakes enabled
    mkdir -p "$HOME/.config/nix"
    if ! grep -q "experimental-features" "$HOME/.config/nix/nix.conf" 2>/dev/null; then
        echo "experimental-features = nix-command flakes" >> "$HOME/.config/nix/nix.conf"
        echo -e "${GREEN}→ enabled flakes in ~/.config/nix/nix.conf${NC}"
    fi
    exit 0
fi

if [ "$MODE" = "auto" ]; then
    if sudo -n true 2>/dev/null; then
        MODE="daemon"
    else
        MODE="no-daemon"
    fi
    echo -e "${CYAN}→ auto mode: $MODE (use --daemon or --no-daemon to override)${NC}"
fi

# ensure curl
if ! command -v curl >/dev/null 2>&1; then
    echo -e "${RED}✗ curl not found${NC}" >&2
    exit 1
fi

INSTALLER_TMP="$(mktemp -t nix-install-XXXXXX.sh)"
curl -fsLS https://nixos.org/nix/install -o "$INSTALLER_TMP"
chmod +x "$INSTALLER_TMP"

enable_flakes() {
    mkdir -p "$HOME/.config/nix"
    if ! grep -q "experimental-features" "$HOME/.config/nix/nix.conf" 2>/dev/null; then
        echo "experimental-features = nix-command flakes" >> "$HOME/.config/nix/nix.conf"
        echo -e "${GREEN}→ flakes enabled (~/.config/nix/nix.conf)${NC}"
    fi
}

ensure_nix_store() {
    if [ -d /nix ]; then return 0; fi
    echo -e "${YELLOW}→ /nix not found, creating store directory...${NC}"
    # try passwordless sudo first
    if sudo -n mkdir -m 0755 /nix 2>/dev/null && sudo -n chown "$USER" /nix 2>/dev/null; then
        echo -e "${GREEN}✓ /nix created via sudo -n${NC}"
        return 0
    fi
    # try pkexec (polkit GUI prompt on CachyOS/KDE)
    if command -v pkexec >/dev/null 2>&1; then
        echo -e "${CYAN}→ Trying pkexec (will show GUI password prompt if needed)...${NC}"
        if pkexec mkdir -m 0755 /nix 2>/dev/null && pkexec chown "$USER" /nix 2>/dev/null; then
            echo -e "${GREEN}✓ /nix created via pkexec${NC}"
            return 0
        fi
    fi
    # fallback: manual instruction
    echo -e "${RED}✗ Cannot create /nix without sudo${NC}" >&2
    echo -e "" >&2
    echo -e "${BOLD}One-time setup required (needs sudo password once):${NC}" >&2
    echo -e "  ${CYAN}sudo mkdir -m 0755 /nix && sudo chown $USER /nix${NC}" >&2
    echo -e "" >&2
    echo -e "After that, re-run: ${CYAN}bash $0 --no-daemon${NC}  (no sudo needed anymore)" >&2
    echo -e "Or for daemon:  ${CYAN}bash $0 --daemon${NC}" >&2
    return 1
}

if [ "$MODE" = "daemon" ]; then
    echo -e "${BOLD}→ Installing Nix (daemon, multi-user)${NC}"
    echo "  Requires sudo. If sudo prompts for password, enter it in this terminal."
    if ! sudo -v 2>&1; then
        echo -e "${RED}✗ sudo required for --daemon${NC}" >&2
        echo -e "  Fallback: ${CYAN}bash $0 --no-daemon${NC} (needs one-time: sudo mkdir -m 0755 /nix && sudo chown \$USER /nix)${NC}" >&2
        exit 1
    fi
    sh "$INSTALLER_TMP" --daemon "${EXTRA_ARGS[@]}"
    # source daemon profile for current shell
    if [ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]; then
        # shellcheck source=/dev/null
        source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
    fi
else
    echo -e "${BOLD}→ Installing Nix (single-user, no sudo)${NC}"
    echo -e "  Note: single-user still needs ${CYAN}/nix${NC} owned by you (one-time sudo mkdir)."
    if ! ensure_nix_store; then
        exit 1
    fi
    sh "$INSTALLER_TMP" --no-daemon "${EXTRA_ARGS[@]}"
    # source single-user profile
    if [ -f "$HOME/.nix-profile/etc/profile.d/nix.sh" ]; then
        # shellcheck source=/dev/null
        source "$HOME/.nix-profile/etc/profile.d/nix.sh"
    fi
    # also ensure PATH for current session
    export PATH="$HOME/.nix-profile/bin:$PATH"
fi

enable_flakes

echo ""
if command -v nix >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Nix installed: $(nix --version)${NC}"
    echo -e "  Mode: $MODE"
    echo ""
    echo -e "  Next: ${CYAN}bash scripts/hm-switch.sh laptop${NC}"
    echo -e "  Or reload shell: ${CYAN}source ~/.zshrc${NC} / ${CYAN}exec \$SHELL -l${NC}"
else
    echo -e "${RED}✗ Nix install finished but nix not in PATH${NC}" >&2
    echo -e "  Try: ${CYAN}source ~/.nix-profile/etc/profile.d/nix.sh${NC}"
    echo -e "  Or:  ${CYAN}source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh${NC}"
    exit 1
fi
