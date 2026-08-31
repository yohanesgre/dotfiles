#!/usr/bin/env bash
# setup-nopasswd-sudo.sh — toggle passwordless sudo untuk machine ini (CachyOS)
# Usage:
#   bash scripts/setup-nopasswd-sudo.sh --status              # cek status
#   bash scripts/setup-nopasswd-sudo.sh --enable              # enable nix-only (default, aman)
#   bash scripts/setup-nopasswd-sudo.sh --enable --full       # enable full NOPASSWD:ALL
#   bash scripts/setup-nopasswd-sudo.sh --enable --nix-only   # enable hanya untuk /nix + nix
#   bash scripts/setup-nopasswd-sudo.sh --disable             # disable (hapus rule)
#   bash scripts/setup-nopasswd-sudo.sh --toggle              # toggle enable/disable
#
# Butuh sudo/password SEKALI saat enable/disable (via sudo atau pkexec GUI).
# Setelah enable, `sudo -n true` akan sukses dan `bash scripts/install-nix.sh --no-daemon`
# bisa jalan tanpa password (kecuali /nix creation pertama sudah beres).
set -euo pipefail

SUDOERS_FILE="/etc/sudoers.d/10-yohanes-nopasswd"
MODE="status" # status|enable|disable|toggle
SCOPE="nix-only" # nix-only|full

for arg in "$@"; do
    case "$arg" in
        --enable) MODE="enable" ;;
        --disable) MODE="disable" ;;
        --toggle) MODE="toggle" ;;
        --status) MODE="status" ;;
        --full) SCOPE="full" ;;
        --nix-only) SCOPE="nix-only" ;;
        --help|-h)
            sed -n '2,20p' "$0"
            exit 0
            ;;
        *) echo "Unknown arg: $arg" >&2; exit 1 ;;
    esac
done

# --- helpers ---
has_nopasswd() { sudo -n true 2>/dev/null; }
has_rule_file() { [ -f "$SUDOERS_FILE" ]; }
visudo_check() { visudo -c 2>&1 | head -5; }

run_as_root() {
    # $1 = command string
    local cmd="$1"
    if sudo -n true 2>/dev/null; then
        sudo bash -c "$cmd"
        return $?
    fi
    if command -v pkexec >/dev/null 2>&1; then
        echo "→ Meminta auth via pkexec (GUI prompt)..." >&2
        # pass DISPLAY/WAYLAND to pkexec env
        pkexec bash -c "$cmd"
        return $?
    fi
    # fallback: try sudo (will prompt for password in terminal)
    echo "→ Meminta sudo password di terminal..." >&2
    sudo bash -c "$cmd"
}

status() {
    echo "=== NOPASSWD status ==="
    if has_nopasswd; then
        echo "sudo -n: YES (passwordless aktif)"
    else
        echo "sudo -n: NO (butuh password)"
    fi
    if has_rule_file; then
        echo "Rule file: $SUDOERS_FILE EXISTS"
        echo "--- content ---"
        if sudo -n cat "$SUDOERS_FILE" 2>/dev/null; then
            :
        elif command -v pkexec >/dev/null 2>&1; then
            pkexec cat "$SUDOERS_FILE" 2>/dev/null || echo "(pkexec dismissed - but file exists)"
        else
            echo "(butuh sudo untuk baca)"
        fi
        echo "---------------"
    else
        echo "Rule file: $SUDOERS_FILE NOT FOUND"
    fi
    # also try to read via pkexec/cat without sudo if possible
    if [ -r "$SUDOERS_FILE" ]; then
        cat "$SUDOERS_FILE"
    fi
}

enable_rule() {
    local content
    if [ "$SCOPE" = "full" ]; then
        content="yohanes ALL=(ALL) NOPASSWD: ALL"
        echo "→ Enable FULL NOPASSWD (yohanes ALL=(ALL) NOPASSWD: ALL)"
    else
        # nix-only: minimal untuk dotfiles (prinsip least privilege)
        # - mkdir/chown /nix (one-time)
        # - nix installer & daemon
        # - home-manager via nix
        content="yohanes ALL=(ALL) NOPASSWD: /usr/bin/mkdir -m 0755 /nix, /usr/bin/mkdir /nix, /bin/mkdir -m 0755 /nix, /bin/mkdir /nix, /usr/bin/chown yohanes /nix, /bin/chown yohanes /nix, /usr/bin/chown -R yohanes /nix, /bin/chown -R yohanes /nix, /usr/bin/nix*, /nix/var/nix/profiles/default/bin/nix*, /home/yohanes/.nix-profile/bin/nix*"
        # fallback: if too strict dan ada kebutuhan lain, user bisa --full
        # simpler: also allow ALL for now if nix-only causes issues, ganti ke full via --full
        # Untuk kemudahan, kita buat nix-only tapi tetap allow mkdir/chown; kalau mau full tinggal --full
        echo "→ Enable NIX-ONLY NOPASSWD (mkdir/chown /nix + nix*)"
        echo "  Tips: kalau masih minta password untuk command lain, pakai --full"
    fi

    # create sudoers file atomically + validate
    local tmp
    tmp="$(mktemp)"
    echo "$content" > "$tmp"
    echo "# managed by dotfiles scripts/setup-nopasswd-sudo.sh ($SCOPE) - disable via: bash $0 --disable" >> "$tmp"
    chmod 0440 "$tmp"

    # validate
    if ! visudo -c -f "$tmp" 2>&1 | grep -q "parsed OK\|OK"; then
        # visudo -c -f not always available, try visudo -c
        if ! sudo visudo -c -f "$tmp" 2>&1 | grep -qi "ok"; then
            # fallback check: just ensure syntax has NOPASSWD
            grep -q "NOPASSWD" "$tmp" || { echo "Invalid sudoers content" >&2; rm -f "$tmp"; exit 1; }
        fi
    fi

    run_as_root "install -m 0440 $tmp $SUDOERS_FILE && visudo -c && echo '✓ installed $SUDOERS_FILE'"
    rm -f "$tmp"

    echo "✓ NOPASSWD enabled ($SCOPE)"
    echo "  Test: sudo -n true && echo 'ok - no password needed' || echo 'still needs password'"
    if has_nopasswd; then
        echo "✓ Verifikasi: passwordless AKTIF"
    else
        echo "⚠ Verifikasi: masih butuh password (coba logout/login atau cek polkit)"
    fi
}

disable_rule() {
    if [ ! -f "$SUDOERS_FILE" ]; then
        echo "→ Sudah disabled (file tidak ada)"
        return 0
    fi
    run_as_root "rm -f $SUDOERS_FILE && visudo -c && echo '✓ removed $SUDOERS_FILE'"
    echo "✓ NOPASSWD disabled"
}

case "$MODE" in
    status) status ;;
    enable) enable_rule ;;
    disable) disable_rule ;;
    toggle)
        if has_rule_file || has_nopasswd; then
            echo "→ Toggle: disable"
            disable_rule
        else
            echo "→ Toggle: enable ($SCOPE)"
            enable_rule
        fi
        ;;
esac
