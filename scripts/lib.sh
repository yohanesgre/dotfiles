#!/usr/bin/env bash
# lib.sh — Shared cross-platform helpers for Opencode Dotfiles scripts
# Source usage: source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# ── Colors ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# ── Platform detection ───────────────────────────────────────────────────
PLATFORM=""
detect_platform() {
    [ -n "$PLATFORM" ] && return 0
    case "$(uname -s)" in
        Darwin) PLATFORM="macos" ;;
        Linux)  PLATFORM="linux" ;;
        *)      PLATFORM="unknown" ;;
    esac
}

# ── PATH helpers ─────────────────────────────────────────────────────────
get_extra_path() {
    detect_platform
    case "$PLATFORM" in
        macos) echo "/opt/homebrew/bin" ;;
        linux) echo "$HOME/.local/bin" ;;
        *)     echo "" ;;
    esac
}

extend_path() {
    export PATH="$HOME/.bun/bin:/usr/local/bin:$(get_extra_path):$PATH"
}

# ── Command checks ───────────────────────────────────────────────────────
# Returns 0 if cmd is found in PATH or common binary locations
check_cmd() {
    local cmd="$1"
    command -v "$cmd" >/dev/null 2>&1 ||
    [ -x "$HOME/.bun/bin/$cmd" ] ||
    [ -x "/opt/homebrew/bin/$cmd" ] ||
    [ -x "/usr/local/bin/$cmd" ] ||
    [ -x "$HOME/.local/bin/$cmd" ]
}

# Exit with error if cmd not found
require_cmd() {
    local cmd="$1" hint="${2:-}"
    if check_cmd "$cmd"; then return 0; fi
    echo -e "${RED}✗ Required: $cmd${NC}" >&2
    [ -n "$hint" ] && echo "  Install: $hint" >&2
    exit 1
}
