#!/usr/bin/env bash
# Standalone fallback for home-manager activations (manual + upstream + opencode).
# Normally runs automatically on `home-manager switch`; run this if HM is unavailable.
# Installs when missing, updates on every run (non-blocking: `|| warn`).
set -euo pipefail

warn() { echo "install-manual: $*" >&2; }
info() { echo "install-manual: $*"; }
is_upstream() {
  local bin resolved
  bin="$(command -v "$1" 2>/dev/null || true)"
  [ -n "$bin" ] || return 1
  resolved="$(readlink -f "$bin" 2>/dev/null || echo "$bin")"
  [ -x "$resolved" ] || return 1
  case "$resolved" in /nix/store/*) return 1;; *) return 0;; esac
}

export BUN_INSTALL="$HOME/.bun"
mkdir -p "$HOME/.bun/bin" "$HOME/.local/bin" "$HOME/go/bin"

# engram: Gentleman-Programming/engram — not in nixpkgs, update every run
if command -v go >/dev/null 2>&1; then
  info "installing/updating engram (Gentleman-Programming)..."
  go install github.com/Gentleman-Programming/engram/cmd/engram@latest 2>&1 || warn "go install engram failed"
  [ -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ] && ln -sf "$HOME/go/bin/engram" "$HOME/.local/bin/engram" 2>/dev/null || true
else
  warn "go not in PATH — skipping go install engram"
fi

# bun: oven-sh/bun — official installer (nixpkgs lags: 1.3.13 vs 1.4.2 on 2026-09-07)
if [ -L "$HOME/.bun/bin/bun" ]; then
  info "removing stale nix bun shim..."
  rm -f "$HOME/.bun/bin/bun" "$HOME/.bun/bin/bunx"
fi
if is_upstream bun; then
  info "updating bun..."
  bun upgrade 2>&1 || warn "bun upgrade failed"
else
  info "installing bun (oven-sh/bun)..."
  curl -fsSL https://bun.sh/install | bash 2>&1 || warn "bun install failed"
fi

# codegraph: colbymchenry/codegraph — bun global install (OpenCode MCP)
if [ -x "$HOME/.bun/bin/bun" ]; then
  if is_upstream codegraph; then
    info "updating codegraph..."
  else
    info "installing codegraph (colbymchenry)..."
  fi
  "$HOME/.bun/bin/bun" install -g --trust @colbymchenry/codegraph 2>&1 || warn "codegraph install/update failed"
else
  warn "bun missing — skipping codegraph"
fi

# rtk: rtk-ai/rtk — official installer, re-run = update (pin via RTK_VERSION=vX.Y.Z)
info "installing/updating rtk (rtk-ai)..."
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh 2>&1 || warn "rtk install/update failed"

# herdr: herdrdev — official installer (`herdr update` only works on direct installs)
if is_upstream herdr; then
  info "updating herdr..."
  herdr update 2>&1 || warn "herdr update failed"
else
  info "installing herdr (herdrdev)..."
  curl -fsSL https://herdr.dev/install.sh | sh 2>&1 || warn "herdr install failed"
fi

# opencode via bun (see home/modules/opencode): always install -g --trust = install or update.
# NOTE: v2 ships on the SCOPED @opencode/cli `latest` tag (2.0.x). The `beta` tag still points at
# the old v1 prerelease line (0.0.0-beta-N), so pin `@latest`. `opencode` is the canonical bin
# (`opencode2` is a redundant alias). Keep target in sync with home/modules/opencode/default.nix.
BUN_BIN="$HOME/.bun/bin/bun"
if [ -x "$BUN_BIN" ]; then
  info "installing/updating @opencode/cli@latest via bun..."
  "$BUN_BIN" install -g --trust @opencode/cli@latest 2>&1 || warn "opencode install/update failed"
else
  warn "bun missing — skipping opencode"
fi

info "done"
