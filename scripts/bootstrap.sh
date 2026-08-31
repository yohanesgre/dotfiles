#!/usr/bin/env bash
# bootstrap.sh — one-shot clean-machine setup untuk dotfiles (CachyOS)
# - enable nopasswd (optional, biar cepat integrasi clean machine)
# - install Nix (daemon/no-daemon auto)
# - hm-switch ke host yang sesuai
#
# Usage:
#   bash scripts/bootstrap.sh                          # auto detect host (dell-xps13/desktop/laptop)
#   bash scripts/bootstrap.sh --host dell-xps13        # explicit host
#   bash scripts/bootstrap.sh --host laptop --no-nopasswd  # skip nopasswd setup
#   bash scripts/bootstrap.sh --host dell-xps13 --full-nopasswd  # full NOPASSWD:ALL
#   bash scripts/bootstrap.sh --remote --host dell-xps13  # no clone, github:yohanesgre/dotfiles
#   bash scripts/bootstrap.sh --yes                    # non-interactive
set -euo pipefail

SCRIPT_SRC="${BASH_SOURCE[0]}"
if [ -L "$SCRIPT_SRC" ]; then
    SCRIPT_SRC="$(readlink -f "$SCRIPT_SRC" 2>/dev/null || realpath "$SCRIPT_SRC" 2>/dev/null || echo "$SCRIPT_SRC")"
fi
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SRC")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
# ensure nix in PATH for all steps
for _f in "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh" "$HOME/.nix-profile/etc/profile.d/nix.sh"; do [ -f "$_f" ] && source "$_f" 2>/dev/null && break; done
export PATH="$HOME/.nix-profile/bin:/nix/var/nix/profiles/default/bin:$PATH"

HOST=""
DO_NOPASSWD=true
NOPASSWD_SCOPE="nix-only"  # nix-only|full
USE_REMOTE=false
EXTRA_NIX_ARGS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --host=*) HOST="${1#--host=}"; shift ;;
        --host) HOST="$2"; shift 2 ;;
        --no-nopasswd) DO_NOPASSWD=false; shift ;;
        --full-nopasswd|--full) NOPASSWD_SCOPE="full"; shift ;;
        --nix-only) NOPASSWD_SCOPE="nix-only"; shift ;;
        --remote) USE_REMOTE=true; shift ;;
        --yes|-y) EXTRA_NIX_ARGS+=("--yes"); shift ;;
        --help|-h)
            sed -n '2,30p' "$0"
            exit 0
            ;;
        desktop|laptop|dell-xps13|dell-xps13-cachyos)
            HOST="$1"; shift
            ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

# auto host
if [ -z "$HOST" ]; then
    HOST="$(hostname 2>/dev/null || echo dell-xps13)"
    case "$HOST" in
        dell-xps13-cachyos) HOST="dell-xps13" ;;
        dell-xps13*) HOST="dell-xps13" ;;
        desktop|laptop) ;;
        *) HOST="dell-xps13" ;;
    esac
    echo -e "${CYAN}→ auto host: $HOST${NC}"
fi

echo -e "${BOLD}══════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Dotfiles Bootstrap — $HOST${NC}"
if [ "$USE_REMOTE" = true ]; then
    echo -e "${BOLD}  Mode: REMOTE (no clone, github:yohanesgre/dotfiles)${NC}"
else
    echo -e "${BOLD}  Mode: LOCAL (~/projects/dotfiles)${NC}"
fi
echo -e "${BOLD}══════════════════════════════════════════════${NC}"
echo ""

# 0. Ensure repo for LOCAL mode (clone if missing, for dev)
if [ "$USE_REMOTE" = false ]; then
    if [ ! -f "$HOME/projects/dotfiles/flake.nix" ] && [ ! -f "./flake.nix" ]; then
        echo -e "${BOLD}Step 0: Clone dotfiles (LOCAL dev)${NC}"
        if ! command -v git >/dev/null 2>&1; then
            echo -e "  ${RED}✗ git not found, falling back to --remote${NC}"
            USE_REMOTE=true
        else
            mkdir -p "$HOME/projects"
            echo -e "  ${CYAN}→ git clone https://github.com/yohanesgre/dotfiles.git ~/projects/dotfiles${NC}"
            if git clone https://github.com/yohanesgre/dotfiles.git "$HOME/projects/dotfiles" 2>&1; then
                echo -e "  ${GREEN}✓ cloned${NC}"
                # update SCRIPT_DIR to new clone
                SCRIPT_DIR="$HOME/projects/dotfiles/scripts"
            else
                echo -e "  ${YELLOW}⚠ clone failed, falling back to --remote${NC}"
                USE_REMOTE=true
            fi
        fi
        echo ""
    else
        if [ -d "$HOME/projects/dotfiles/.git" ]; then
            echo -e "  ${CYAN}→ repo exists: ~/projects/dotfiles (use git pull to update)${NC}"
            # if SSH key exists but remote is https, suggest/switch to ssh for easy push
            if [ -f "$HOME/.ssh/id_ed25519" ] || [ -f "$HOME/.ssh/id_rsa" ]; then
                _remote_url="$(git -C "$HOME/projects/dotfiles" remote get-url origin 2>/dev/null || echo "")"
                if [[ "$_remote_url" == https://* ]]; then
                    echo -e "  ${CYAN}→ SSH key exists, switching remote to ssh for push: git@github.com:yohanesgre/dotfiles.git${NC}"
                    git -C "$HOME/projects/dotfiles" remote set-url origin git@github.com:yohanesgre/dotfiles.git 2>&1 || true
                fi
                unset _remote_url
            fi
        fi
    fi
fi

# 0.5 Ensure .env.toml (private, gitignored) — auto-create from example for easy bootstrap
if [ ! -f "$HOME/projects/dotfiles/.env.toml" ] && [ ! -f "$HOME/.env.toml" ]; then
    echo -e "${BOLD}Step 0.5: .env.toml (private)${NC}"
    EXAMPLE=""
    if [ -f "$HOME/projects/dotfiles/.env.toml.example" ]; then
        EXAMPLE="$HOME/projects/dotfiles/.env.toml.example"
    elif [ -f "./.env.toml.example" ]; then
        EXAMPLE="./.env.toml.example"
    fi
    DEST="$HOME/.env.toml"
    # for LOCAL mode, prefer dotfiles dir if it exists
    if [ "$USE_REMOTE" = false ] && [ -d "$HOME/projects/dotfiles" ]; then
        DEST="$HOME/projects/dotfiles/.env.toml"
    fi
    if [ -n "$EXAMPLE" ]; then
        echo -e "  ${CYAN}→ cp $EXAMPLE -> $DEST${NC}"
        cp "$EXAMPLE" "$DEST" 2>&1 && echo -e "  ${GREEN}✓ created $DEST (edit to fill secrets)${NC}" || echo -e "  ${YELLOW}⚠ copy failed${NC}"
    else
        echo -e "  ${CYAN}→ curl .env.toml.example -> $DEST${NC}"
        if curl -fsSL https://raw.githubusercontent.com/yohanesgre/dotfiles/main/.env.toml.example -o "$DEST" 2>&1; then
            echo -e "  ${GREEN}✓ created $DEST (edit to fill secrets)${NC}"
        else
            echo -e "  ${YELLOW}⚠ curl failed, create manually: cp .env.toml.example .env.toml${NC}"
        fi
    fi
    echo -e "  ${YELLOW}→ Edit $DEST to fill DISCORD_BOT_TOKEN / API keys, then: ${CYAN}exec \$SHELL -l${NC}${NC}"
    echo ""
else
    if [ -f "$HOME/projects/dotfiles/.env.toml" ]; then
        echo -e "  ${CYAN}→ .env.toml exists: ~/projects/dotfiles/.env.toml${NC}"
    elif [ -f "$HOME/.env.toml" ]; then
        echo -e "  ${CYAN}→ .env.toml exists: ~/.env.toml${NC}"
    fi
fi

# 0.6 Ensure SSH key for git push (dev)
if [ ! -f "$HOME/.ssh/id_ed25519" ] && [ ! -f "$HOME/.ssh/id_rsa" ]; then
    echo -e "${BOLD}Step 0.6: SSH key (for git push)${NC}"
    if command -v ssh-keygen >/dev/null 2>&1; then
        HOST_SHORT="$(hostname | cut -d. -f1)"
        echo -e "  ${CYAN}→ ssh-keygen -t ed25519 -C \"$HOST_SHORT\" -f ~/.ssh/id_ed25519 -N ''${NC}"
        mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
        if ssh-keygen -t ed25519 -C "$HOST_SHORT" -f "$HOME/.ssh/id_ed25519" -N "" 2>&1 | head -5; then
            echo -e "  ${GREEN}✓ created ~/.ssh/id_ed25519.pub${NC}"
            echo -e "  ${YELLOW}→ Add to GitHub: https://github.com/settings/keys -> New SSH key, paste:${NC}"
            cat "$HOME/.ssh/id_ed25519.pub" 2>&1 | sed 's/^/    /'
            # known_hosts
            mkdir -p "$HOME/.ssh" && ssh-keyscan -t ed25519 github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null
            ssh-keyscan -t rsa github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null
            chmod 600 "$HOME/.ssh/known_hosts" 2>/dev/null || true
            echo -e "  ${CYAN}→ after Add, test: ssh -T git@github.com${NC}"
        fi
    else
        echo -e "  ${YELLOW}⚠ ssh-keygen not found, skip${NC}"
    fi
    echo ""
fi

# 1. NOPASSWD setup (biar clean machine cepat, 1x password aja)
if [ "$DO_NOPASSWD" = true ]; then
    echo -e "${BOLD}Step 1: NOPASSWD sudo ($NOPASSWD_SCOPE)${NC}"
    if sudo -n true 2>/dev/null; then
        echo -e "  ${GREEN}✓ already passwordless${NC}"
    else
        echo -e "  ${YELLOW}→ enabling passwordless sudo ($NOPASSWD_SCOPE)...${NC}"
        if [ "$NOPASSWD_SCOPE" = "full" ]; then
            bash "$SCRIPT_DIR/setup-nopasswd-sudo.sh" --enable --full || echo -e "  ${YELLOW}⚠ nopasswd enable failed — lanjut manual (akan minta password lagi)${NC}"
        else
            bash "$SCRIPT_DIR/setup-nopasswd-sudo.sh" --enable --nix-only || echo -e "  ${YELLOW}⚠ nopasswd enable failed — lanjut manual${NC}"
        fi
        if sudo -n true 2>/dev/null; then
            echo -e "  ${GREEN}✓ passwordless aktif${NC}"
        else
            echo -e "  ${YELLOW}⚠ masih butuh password (bisa di-skip, nanti tiap sudo minta password)${NC}"
        fi
    fi
    echo ""
else
    echo -e "${YELLOW}→ Skip NOPASSWD ( --no-nopasswd )${NC}"
    echo ""
fi

# 2. Nix install
echo -e "${BOLD}Step 2: Nix install${NC}"
if command -v nix >/dev/null 2>&1 || [ -e /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ] || [ -e "$HOME/.nix-profile/etc/profile.d/nix.sh" ]; then
    echo -e "  ${GREEN}✓ Nix already installed: $(nix --version 2>&1 || echo nix)${NC}"
else
    echo -e "  ${CYAN}→ installing Nix (auto mode)...${NC}"
    bash "$SCRIPT_DIR/install-nix.sh" "${EXTRA_NIX_ARGS[@]}" || {
        echo -e "${RED}✗ Nix install failed${NC}" >&2
        echo -e "  Coba manual: ${CYAN}bash $SCRIPT_DIR/install-nix.sh --no-sudo${NC}" >&2
        exit 1
    }
    # source for current shell
    for f in "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh" "$HOME/.nix-profile/etc/profile.d/nix.sh"; do
        [ -f "$f" ] && source "$f" && break
    done
    export PATH="$HOME/.nix-profile/bin:/nix/var/nix/profiles/default/bin:$PATH"
fi
echo ""

# 3. home-manager switch
if [ "$USE_REMOTE" = true ]; then
    echo -e "${BOLD}Step 3: home-manager switch --flake github:yohanesgre/dotfiles#yohanes@$HOST (remote, no clone)${NC}"
    bash "$SCRIPT_DIR/hm-switch.sh" --remote "$HOST"
else
    echo -e "${BOLD}Step 3: home-manager switch --flake .#yohanes@$HOST${NC}"
    bash "$SCRIPT_DIR/hm-switch.sh" "$HOST"
fi
echo ""

echo -e "${GREEN}${BOLD}✓ Bootstrap done — $HOST${NC}"
echo -e "  Host: ${CYAN}$HOST${NC} ($(hostname))"
echo -e "  Shell: ${CYAN}$(/usr/bin/getent passwd "$USER" 2>/dev/null | cut -d: -f7 || echo $SHELL)${NC}"
# source nix for final check
for _f in "/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh" "$HOME/.nix-profile/etc/profile.d/nix.sh"; do [ -f "$_f" ] && source "$_f" 2>/dev/null && break; done
export PATH="$HOME/.nix-profile/bin:/nix/var/nix/profiles/default/bin:$PATH"
echo -e "  Nix: ${CYAN}$(nix --version 2>&1 || echo 'not in PATH (reload shell)')${NC}"
echo -e "  Next: ${CYAN}exec \$SHELL -l${NC}  (reload zsh)"
if [ "$DO_NOPASSWD" = true ] && ! sudo -n true 2>/dev/null; then
    echo -e "  Note: NOPASSWD belum aktif — jalanin: ${CYAN}bash $SCRIPT_DIR/setup-nopasswd-sudo.sh --enable --full${NC}"
fi
