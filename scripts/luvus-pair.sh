#!/usr/bin/env bash
# luvus-pair.sh — print a one-use pairing link for the Luvus Web bridge.
#
# Why this exists: `luvus web` prints its pairing link once, at start, to its own
# terminal. The bridge runs as a systemd user unit (home/hosts/desktop.nix), so it
# has no terminal, and neither the CLI nor UHP exposes a way to mint another link:
# a fresh link means a fresh bridge start. This script restarts the unit and reads
# the link the new bridge logged, or re-reads the current bridge's link while its
# five-minute window is still open.
#
# Usage:
#   bash scripts/luvus-pair.sh                 # mint: restart the unit, print the new link
#   bash scripts/luvus-pair.sh --current       # no restart: the current link, if still fresh
#   bash scripts/luvus-pair.sh --no-clip       # leave the clipboard alone
#   bash scripts/luvus-pair.sh --unit <unit> --host <origin>
#
# stdout is exactly the link, so `link=$(bash scripts/luvus-pair.sh)` works.
# Status and warnings go to stderr.
#
# A restart revokes every paired browser — browser tickets do not survive the
# bridge's shutdown — which is why --current exists.
#
# Exit codes: 0 link printed · 1 no fresh link · 2 usage or systemd error
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

UNIT="luvus-web.service"
HOST="https://luvus.yohanesgre.com"
TTL=300             # the bridge's own pairing window, in seconds
CURRENT=false
CLIP=true

usage() { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed -e 's/^# \?//' -e '$d'; }
warn() { printf "${YELLOW}luvus-pair:${NC} %s\n" "$*" >&2; }
die() { printf "${RED}luvus-pair:${NC} %s\n" "$*" >&2; exit 2; }

while [ $# -gt 0 ]; do
    case "$1" in
        --current) CURRENT=true ;;
        --no-clip) CLIP=false ;;
        --unit) UNIT="${2:?--unit needs a unit name}"; shift ;;
        --host) HOST="${2:?--host needs an origin such as https://example.test}"; shift ;;
        -h | --help) usage; exit 0 ;;
        *) warn "unknown argument: $1"; usage >&2; exit 2 ;;
    esac
    shift
done

check_cmd systemctl || die "systemctl is required"
check_cmd journalctl || die "journalctl is required"
systemctl --user show -p LoadState --value "$UNIT" 2>/dev/null | grep -qv '^not-found$' ||
    die "unit $UNIT does not exist for this user"

# The bridge always logs the link with the origin it was started with
# (--public-url) or its loopback address; match that exact prefix.
LINK_RE="$(printf '%s' "$HOST" | sed 's/[.[\*^$]/\\&/g')/#pair=[A-Za-z0-9_-]+"

# Only the current bridge process's own lines count, so a link logged by an
# earlier run can never be handed out.
link_since() {
    local pid
    pid="$(systemctl --user show -p MainPID --value "$UNIT")"
    [ -n "$pid" ] && [ "$pid" != "0" ] || return 0
    journalctl --user -u "$UNIT" _PID="$pid" --since "$1" --no-pager 2>/dev/null |
        grep -oE "$LINK_RE" | tail -1 || true
}

if [ "$CURRENT" = true ]; then
    systemctl --user is-active --quiet "$UNIT" || die "unit $UNIT is not running — rerun without --current"
    link="$(link_since "-${TTL}s")"
    if [ -z "$link" ]; then
        warn "the current bridge has logged no pairing link in the last ${TTL}s"
        warn "the bridge only prints one when it starts — rerun without --current to restart it"
        exit 1
    fi
    warn "current bridge instance's link; part of its ${TTL}s window may already be gone"
else
    warn "restarting $UNIT — this revokes every paired browser"
    start="$(date +%s)"
    systemctl --user restart "$UNIT"
    deadline=$((start + 20))
    link=""
    while [ -z "$link" ] && [ "$(date +%s)" -lt "$deadline" ]; do
        link="$(link_since "@$((start - 2))")"
        [ -n "$link" ] || sleep 0.25
    done
    if [ -z "$link" ]; then
        warn "no pairing link appeared within 20s — check: journalctl --user -u $UNIT"
        exit 1
    fi
    warn "one-use link, valid ${TTL}s from when the bridge printed it; paste it in one browser tab"
fi

if [ "$CLIP" = true ]; then
    for c in wl-copy xclip xsel; do
        check_cmd "$c" || continue
        if case "$c" in
            wl-copy) printf '%s' "$link" | wl-copy 2>/dev/null ;;
            xclip) printf '%s' "$link" | xclip -selection clipboard 2>/dev/null ;;
            xsel) printf '%s' "$link" | xsel -ib 2>/dev/null ;;
        esac; then
            warn "copied to the clipboard with $c"
            break
        fi
    done
fi

printf '%s\n' "$link"
