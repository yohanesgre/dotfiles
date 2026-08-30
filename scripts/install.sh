#!/usr/bin/env bash
# Opencode Dotfiles — post-clone installer
# Usage:
#   git clone git@github.com:yohanesgre/dotfiles.git <any-directory>
#   bash <any-directory>/scripts/install.sh
# (Auto-detects repo root — works from any location)
#
# Works on: Linux (Arch, Debian/Ubuntu, Fedora) and macOS
# Idempotent: safe to re-run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHEZMOI_SOURCE="$(cd "$SCRIPT_DIR/.." && pwd)"

source "$SCRIPT_DIR/lib.sh"
extend_path

# ── Colors ───────────────────────────────────────────────────────────────
# (RED, GREEN, YELLOW, BLUE, NC from lib.sh)
info()  { echo -e "${BLUE}→${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*"; }

# ── 1. OS Detection ──────────────────────────────────────────────────────
detect_platform
OS="$PLATFORM"
echo ""
echo "══════════════════════════════════════════════"
echo "  Opencode Dotfiles Installer"
echo "  OS: $OS"
echo "══════════════════════════════════════════════"
echo ""

# ── 2. Cache sudo credentials (Linux only) ──────────────────────────────────
SUDO_AVAILABLE=false
if [ "$OS" = "linux" ]; then
    # -n = non-interactive (no prompt), -v = validate/cache credentials
    if sudo -n true 2>/dev/null || sudo -v 2>/dev/null; then
        SUDO_AVAILABLE=true
        info "sudo credentials cached for this session"
    else
        warn "sudo not available — will print manual install instructions if needed"
    fi
fi

# ── 3. Install prerequisites ──────────────────────────────────────────────
info "Checking prerequisites..."

# macOS: ensure Homebrew
if [ "$OS" = "macos" ]; then
    if ! command -v brew >/dev/null 2>&1; then
        warn "Homebrew not found. Installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        if [ -f /opt/homebrew/bin/brew ]; then
            eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [ -f /usr/local/bin/brew ]; then
            eval "$(/usr/local/bin/brew shellenv)"
        fi
        ok "Homebrew installed"
    fi
fi

# Helper: install system package via sudo or print instructions
linux_install() {
    local pkg="$1"
    if command -v pacman >/dev/null 2>&1; then
        if [ "$SUDO_AVAILABLE" = true ]; then
            sudo pacman -S --noconfirm "$pkg"
        else
            err "$pkg not found. Run: sudo pacman -S $pkg"
            exit 1
        fi
    elif command -v apt-get >/dev/null 2>&1; then
        if [ "$SUDO_AVAILABLE" = true ]; then
            sudo apt-get update -qq && sudo apt-get install -y -qq "$pkg"
        else
            err "$pkg not found. Run: sudo apt-get install $pkg"
            exit 1
        fi
    elif command -v dnf >/dev/null 2>&1; then
        if [ "$SUDO_AVAILABLE" = true ]; then
            sudo dnf install -y "$pkg"
        else
            err "$pkg not found. Run: sudo dnf install $pkg"
            exit 1
        fi
    else
        err "$pkg not found. Install $pkg using your system package manager."
        exit 1
    fi
}

# git
if ! command -v git >/dev/null 2>&1; then
    if [ "$OS" = "macos" ]; then
        brew install git
    else
        linux_install git
    fi
    ok "git installed"
fi

# curl
if ! command -v curl >/dev/null 2>&1; then
    if [ "$OS" = "macos" ]; then
        brew install curl
    else
        linux_install curl
    fi
    ok "curl installed"
fi

# ── 4. SSH key check ─────────────────────────────────────────────────────
info "Checking SSH configuration..."
if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
    ok "SSH authenticated with GitHub"
else
    if [ ! -f "$HOME/.ssh/id_ed25519" ] && [ ! -f "$HOME/.ssh/id_rsa" ]; then
        warn "No SSH key found. Future 'chezmoi update' will fail."
        echo "  Generate one:"
        echo "    ssh-keygen -t ed25519 -C \"your@email.com\" -f ~/.ssh/id_ed25519 -N \"\""
        echo "    eval \"\$(ssh-agent -s)\" && ssh-add ~/.ssh/id_ed25519"
        echo "    cat ~/.ssh/id_ed25519.pub  →  add to https://github.com/settings/keys"
        echo ""
    else
        warn "SSH key exists but GitHub authentication failed."
        echo "  Try: ssh -T git@github.com"
        echo "  If that fails: ssh-add"
    fi
fi

# ── 5. Install chezmoi ───────────────────────────────────────────────────
if ! command -v chezmoi >/dev/null 2>&1; then
    info "Installing chezmoi..."
    sh -c "$(curl -fsLS get.chezmoi.io)" -- -b "$HOME/.local/bin"
    export PATH="$HOME/.local/bin:$PATH"
    if ! command -v chezmoi >/dev/null 2>&1; then
        err "chezmoi installation failed."
        exit 1
    fi
    ok "chezmoi installed to ~/.local/bin"
else
    ok "chezmoi already installed: $(chezmoi --version 2>&1 | head -1)"
fi

# ── 6. Run chezmoi init & apply ──────────────────────────────────────────
info "Initializing chezmoi..."
if chezmoi init --source="$CHEZMOI_SOURCE" --apply 2>&1; then
    ok "chezmoi init --apply complete"
else
    err "chezmoi init failed. Check the output above."
    exit 1
fi

# ── 7. Install git pre-commit hook ──────────────────────────────────────
info "Installing git pre-commit hook..."
if git -C "$CHEZMOI_SOURCE" config core.hooksPath .githooks 2>&1; then
    ok "pre-commit hook installed (runs validate.sh before every commit)"
else
    warn "could not install pre-commit hook"
fi

# ── 8. Post-apply: PATH warning ──────────────────────────────────────────
LOCAL_BIN="$HOME/.local/bin"
if [ -d "$LOCAL_BIN" ] && ! echo "$PATH" | grep -q "$LOCAL_BIN"; then
    warn "~/.local/bin is not in your PATH."
    echo "  Add this to your shell config:"
    echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# ── 8. Scan machine & report ──────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo "  Installation Summary"
echo "══════════════════════════════════════════════"
echo ""

check_tool() {
    local name="$1" cmd="$2" install_hint="$3"
    if command -v "$cmd" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} $name"
        return 0
    else
        echo -e "  ${RED}✗${NC} $name — $install_hint"
        return 1
    fi
}

echo "Core tools:"
check_tool "chezmoi" chezmoi "sh -c \"\$(curl -fsLS get.chezmoi.io)\" -- -b ~/.local/bin"
if [ "$OS" = "macos" ]; then
    check_tool "node" node "brew install node"
else
    check_tool "node" node "pacman -S nodejs"
fi
check_tool "bun" bun "curl -fsSL https://bun.sh/install | bash"
echo ""

echo "MCP server binaries:"
check_tool "engram" engram "brew install gentleman-programming/tap/engram or download pre-built binary from github.com/Gentleman-Programming/engram/releases"
check_tool "codebase-memory-mcp" codebase-memory-mcp "brew install codebase-memory-mcp or curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash"
echo ""

echo "Optional:"
check_tool "rtk (CLI proxy)" rtk "brew install rtk (macOS) or curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh (Linux)"
check_tool "opencode" opencode "brew install anomalyco/tap/opencode or curl -fsSL https://opencode.ai/install | bash"
echo ""

echo "═══ Next Steps ═══"
echo ""
echo "1. Install missing tools listed above"
echo "2. Run bootstrap (chezmoi handles this automatically on first apply)"
echo "   To re-trigger: chezmoi state delete-bucket --bucket=entryState && chezmoi apply"
echo ""
echo "═══ Daily Commands ═══"
echo ""
echo "  Safe update:     bash ~/projects/dotfiles/scripts/update.sh"
echo "  Quick update:    chezmoi update"
echo "  Make changes:    cd ~/projects/dotfiles && git add -A && git commit -m \"...\" && git push"
echo "  Apply changes:   chezmoi apply"
echo "  Validate setup:  bash ~/projects/dotfiles/scripts/validate.sh"
echo "  Remote sync:     ssh <host> 'bash ~/projects/dotfiles/scripts/update.sh'"
echo "  Uninstall:       bash ~/projects/dotfiles/scripts/uninstall.sh"
echo ""
echo "Done."
