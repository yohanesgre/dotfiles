#!/usr/bin/env bash
# Opencode Dotfiles — uninstaller
# Removes chezmoi-managed configs and optionally uninstalls chezmoi.
# Does NOT remove manually installed tools (engram, codebase-memory-mcp, rtk, etc.)
#
# Usage: bash ~/projects/dotfiles/scripts/uninstall.sh

CHEZMOI_SOURCE="$HOME/projects/dotfiles"
BACKUP_DIR="$HOME/.config/opencode.bak.$(date +%Y%m%d-%H%M%S)"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

# ── Colors ───────────────────────────────────────────────────────────────
# (RED, GREEN, YELLOW, BLUE, NC from lib.sh)
info()  { echo -e "${BLUE}→${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*"; }

# No set -e — we clean up gracefully even if individual steps fail

echo ""
echo "══════════════════════════════════════════════"
echo "  Opencode Dotfiles Uninstaller"
echo "══════════════════════════════════════════════"
echo ""
warn "This will remove chezmoi-managed OpenCode config files and optionally chezmoi itself."
warn "Manually installed tools (engram, codebase-memory-mcp, rtk, opencode) are NOT touched."
echo ""

# ── 1. Confirmation ──────────────────────────────────────────────────────
if [ -t 0 ]; then
    read -rp "  Continue? (y/N): " confirm
    [ "$confirm" = "y" ] || [ "$confirm" = "Y" ] || { info "Aborted."; exit 0; }
else
    warn "Not a terminal — skipping uninstall."
    echo "  Run interactively: bash ~/projects/dotfiles/scripts/uninstall.sh"
    exit 0
fi
echo ""

# ── 2. Backup existing config ────────────────────────────────────────────
if [ -d "$HOME/.config/opencode" ]; then
    info "Backing up ~/.config/opencode/ → $BACKUP_DIR"
    mkdir -p "$BACKUP_DIR" || { err "Failed to create backup directory."; exit 1; }
    cp -r "$HOME/.config/opencode" "$BACKUP_DIR/" && ok "Backup saved to $BACKUP_DIR" || { err "Backup failed."; exit 1; }
else
    info "No existing ~/.config/opencode/ to back up."
fi

# ── 3. Remove chezmoi-managed files ──────────────────────────────────────
if command -v chezmoi >/dev/null 2>&1; then
    info "Removing chezmoi-managed files..."
    MANAGED=$(chezmoi managed --path-style=absolute 2>/dev/null || true)
    if [ -n "$MANAGED" ]; then
        echo "$MANAGED" | while read -r file; do
            if [ -f "$file" ] || [ -L "$file" ]; then
                rm -f "$file" 2>/dev/null && echo "  removed $file" || warn "could not remove $file"
            fi
        done
        ok "Managed files removed"
    else
        info "No managed files to remove."
    fi

    # Clean up chezmoi state
    info "Cleaning up chezmoi state..."
    rm -rf "$HOME/.local/share/chezmoi" 2>/dev/null && ok "Removed ~/.local/share/chezmoi" || warn "Could not remove ~/.local/share/chezmoi"
    rm -rf "$HOME/.config/chezmoi" 2>/dev/null && ok "Removed ~/.config/chezmoi" || true

    # Remove bootstrap script if present
    rm -f "$HOME/run_once_after_bootstrap.sh" 2>/dev/null || true
else
    warn "chezmoi not found in PATH — skipping managed file removal."
    warn "  If ~/.config/opencode/ still exists, remove it manually:"
    warn "    rm -rf ~/.config/opencode"
fi

# ── 4. Optionally remove chezmoi binary ─────────────────────────────────
echo ""
read -rp "  Remove ~/.local/bin/chezmoi? (y/N): " rm_chezmoi
if [ "$rm_chezmoi" = "y" ] || [ "$rm_chezmoi" = "Y" ]; then
    rm -f "$HOME/.local/bin/chezmoi" 2>/dev/null && ok "Removed ~/.local/bin/chezmoi" || warn "Could not remove ~/.local/bin/chezmoi"
fi

# ── 5. Optionally remove dotfiles repo ───────────────────────────────────
echo ""
read -rp "  Remove ~/projects/dotfiles/ (the cloned repo)? (y/N): " rm_repo
if [ "$rm_repo" = "y" ] || [ "$rm_repo" = "Y" ]; then
    rm -rf "$CHEZMOI_SOURCE" 2>/dev/null && ok "Removed $CHEZMOI_SOURCE" || warn "Could not remove $CHEZMOI_SOURCE"
fi

# ── 6. Manual cleanup reminders ──────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo "  Manual Cleanup (not automated)"
echo "══════════════════════════════════════════════"
echo ""
echo "These were NOT removed by the uninstaller. Remove them if desired:"

echo ""
echo "  npm dependencies:"
echo "    rm -rf ~/.config/opencode/node_modules"
echo "    rm -f ~/.config/opencode/package-lock.json"
echo "    rm -f ~/.config/opencode/bun.lock"
echo ""
echo "  OpenSkills (installed by npx):"
echo "    rm -rf ~/.local/share/openskills"
echo ""
echo "  Cloudflare skills (installed via npx skills):"
echo "    rm -rf ~/.agents/skills"
echo ""
echo "  OCX plugins (auto-fetched on opencode start):"
echo "    rm -rf ~/.config/opencode/.opencode"
echo "    rm -rf ~/.config/opencode/.ocx"
echo ""

echo "══════════════════════════════════════════════"
echo "  NOT Touched (manually installed)"
echo "══════════════════════════════════════════════"
echo ""
echo "  engram              — ~/.local/bin/engram (or ~/go/bin/engram)"
echo "  codebase-memory-mcp — ~/.local/bin/codebase-memory-mcp"
echo "  rtk                 — ~/.local/bin/rtk"
echo "  opencode            — system-installed binary"
echo "  bun, node, go       — system packages"
echo ""

info "Done."
