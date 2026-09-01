#!/usr/bin/env bash
set -euo pipefail

# Hermes Agent — isolated installer
# Idempotent: safe to run multiple times
# Port of: ~/apps/hermes/ (self-contained, movable)
# Profiles: yohanes, yola, game-dev-team

HERMES_HOME="${HERMES_HOME:-$HOME/apps/hermes}"
HERMES_REPO="https://github.com/NousResearch/hermes-agent.git"
HERMES_CODE="$HERMES_HOME/hermes-agent"
HERMES_BIN="$HOME/.local/bin/hermes"
DOTFILES="$HOME/projects/dotfiles/config/hermes"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ── Dependencies ──────────────────────────────────────────────

check_deps() {
    local missing=()
    for cmd in git python3; do
        command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
    done
    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Missing dependencies: ${missing[*]}"
        error "Install: sudo pacman -S git python"
        return 1
    fi
    info "Dependencies OK"
}

# ── Clone / update repo ───────────────────────────────────────

clone_or_update() {
    mkdir -p "$HERMES_HOME"

    if [[ -d "$HERMES_CODE/.git" ]]; then
        info "Updating hermes-agent..."
        git -C "$HERMES_CODE" pull --ff-only origin main
    else
        info "Cloning hermes-agent..."
        git clone --depth=1 "$HERMES_REPO" "$HERMES_CODE"
    fi
}

# ── Python venv ────────────────────────────────────────────────

setup_venv() {
    local venv="$HERMES_CODE/venv"

    if [[ -f "$venv/bin/python" ]]; then
        info "Venv exists, updating packages..."
        "$venv/bin/pip" install --upgrade pip -q
        "$venv/bin/pip" install -e "$HERMES_CODE" -q
    else
        info "Creating venv with python3.13..."
        python3.13 -m venv "$venv"
        "$venv/bin/pip" install --upgrade pip -q
        "$venv/bin/pip" install -e "$HERMES_CODE" -q
    fi

    # Symlink binary
    mkdir -p "$(dirname "$HERMES_BIN")"
    ln -sf "$venv/bin/hermes" "$HERMES_BIN"
    info "Binary: $HERMES_BIN"
}

# ── Profiles ───────────────────────────────────────────────────

setup_profiles() {
    local profiles=("yohanes" "yola" "game-dev-team")

    for profile in "${profiles[@]}"; do
        local profile_dir="$HERMES_HOME/profiles/$profile"

        info "Setting up profile: $profile"

        # Create profile directory
        mkdir -p "$profile_dir"

        # Copy config and SOUL from dotfiles (if newer)
        if [[ -d "$DOTFILES/profiles/$profile" ]]; then
            cp -u "$DOTFILES/profiles/$profile/config.yaml" "$profile_dir/config.yaml" 2>/dev/null || true
            cp -u "$DOTFILES/profiles/$profile/SOUL.md"    "$profile_dir/SOUL.md"    2>/dev/null || true
            info "  Config synced from dotfiles"
        fi

        # Check for .env
        if [[ ! -f "$profile_dir/.env" ]]; then
            warn "  No .env at $profile_dir/.env"
            warn "  Create it with: ANTHROPIC_API_KEY=sk-..."
            # Create template
            if [[ ! -f "$profile_dir/.env.template" ]]; then
                cat > "$profile_dir/.env.template" <<'EOF'
# Hermes Agent — secrets for <profile>
# This file is NEVER committed to dotfiles.
# Copy to .env and fill in your keys.
#
# Using OpenCode Go as LLM provider:
#   HERMES_PROVIDER=openai
#   HERMES_MODEL=<model-name>
#   HERMES_BASE_URL=<opencode-go-api-url>
#   OPENAI_API_KEY=<your-api-key>
#
# Or use any OpenAI-compatible provider by setting the vars above.

HERMES_PROVIDER=openai
HERMES_MODEL=gpt-4o
HERMES_BASE_URL=
OPENAI_API_KEY=sk-...

# Gateway (optional — for Telegram/Discord/etc.)
# TELEGRAM_BOT_TOKEN=...
# DISCORD_BOT_TOKEN=...
EOF
                info "  Created .env.template"
            fi
        else
            info "  .env exists"
        fi

        # Create skills dir
        mkdir -p "$profile_dir/skills"
    done

    # Create shared symlink for skills
    if [[ -d "$HOME/.agents/skills" ]]; then
        ln -sfn "$HOME/.agents/skills" "$HERMES_HOME/shared/skills"
        info "Skills symlinked: ~/.agents/skills/ → $HERMES_HOME/shared/skills"
    else
        warn "~/.agents/skills/ not found — run chezmoi apply first"
    fi
}

# ── Systemd services ──────────────────────────────────────────

setup_services() {
    local profiles=("yohanes" "yola" "game-dev-team")

    for profile in "${profiles[@]}"; do
        local service="hermes-gateway-${profile}"
        local unit_file="$HOME/.config/systemd/user/${service}.service"

        info "Setting up systemd: $service"

        # Only create if hermes is available and unit doesn't exist
        if command -v hermes >/dev/null 2>&1; then
            HERMES_HOME="$HERMES_HOME/profiles/$profile" \
                hermes gateway install --profile "$profile" 2>/dev/null || {
                warn "  Could not auto-install $service — create manually with:"
                warn "  HERMES_HOME=$HERMES_HOME/profiles/$profile hermes gateway install"
            }
        fi
    done

    # Enable linger for user services
    if command -v loginctl >/dev/null 2>&1; then
        sudo loginctl enable-linger "$USER" 2>/dev/null || {
            warn "Could not enable linger — services may stop on logout."
            warn "Run: sudo loginctl enable-linger $USER"
        }
    fi

    systemctl --user daemon-reload 2>/dev/null || true
    info "Systemd services configured"
}

# ── Shell integration ─────────────────────────────────────────

setup_shell() {
    local export_line='export HERMES_HOME="$HOME/apps/hermes"'

    for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
        if [[ -f "$rc" ]] && ! grep -qF 'HERMES_HOME' "$rc" 2>/dev/null; then
            echo "$export_line" >> "$rc"
            info "Added HERMES_HOME to $rc"
        fi
    done
}

# ── Verification ──────────────────────────────────────────────

verify() {
    info "Running verification..."

    if "$HERMES_BIN" --version >/dev/null 2>&1; then
        info "Hermes binary OK ($("$HERMES_BIN" --version 2>&1 || true))"
    else
        error "Hermes binary not working. Check installation."
        return 1
    fi

    info "Running hermes doctor..."
    HERMES_HOME="$HERMES_HOME/profiles/yohanes" "$HERMES_BIN" doctor 2>&1 || {
        warn "Hermes doctor reported issues. This is normal before first setup."
    }
}

# ── Summary ────────────────────────────────────────────────────

summary() {
    echo ""
    echo "============================================"
    echo " Hermes Agent installed at: $HERMES_HOME"
    echo "============================================"
    echo ""
    echo "Profiles:"
    echo "  yohanes        → $HERMES_HOME/profiles/yohanes/"
    echo "  yola           → $HERMES_HOME/profiles/yola/"
    echo "  game-dev-team  → $HERMES_HOME/profiles/game-dev-team/"
    echo ""
    echo "Next steps:"
    echo "  1. Create .env files for each profile:"
    for p in yohanes yola game-dev-team; do
        echo "     cp $HERMES_HOME/profiles/$p/.env.template $HERMES_HOME/profiles/$p/.env"
        echo "     # edit $HERMES_HOME/profiles/$p/.env"
    done
    echo ""
    echo "  2. Start gateways:"
    echo "     hermes gateway start --all"
    echo ""
    echo "  3. Check status:"
    echo "     hermes gateway status"
    echo ""
    echo "  Reload shell or: source ~/.zshrc"
    echo "============================================"
}

# ── Main ───────────────────────────────────────────────────────

main() {
    echo ""
    echo "═══ Hermes Agent — Isolated Installer ═══"
    echo ""

    check_deps
    clone_or_update
    setup_venv
    setup_profiles
    setup_shell
    setup_services
    verify
    summary
}

main "$@"
