#!/usr/bin/env bash
set -euo pipefail

warn() { echo "install-manual: $*" >&2; }
info() { echo "install-manual: $*"; }

# engram: Gentleman-Programming/engram — not in nixpkgs, kept manual
if [ ! -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ]; then
  info "installing engram (Gentleman-Programming)..."
  if command -v go >/dev/null 2>&1; then
    go install github.com/Gentleman-Programming/engram/cmd/engram@latest 2>&1 || warn "go install engram failed"
    [ -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ] && ln -sf "$HOME/go/bin/engram" "$HOME/.local/bin/engram" 2>/dev/null || true
  else
    warn "go not in PATH — skipping go install engram"
  fi
else
  info "engram already present — skipping"
  [ -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ] && ln -sf "$HOME/go/bin/engram" "$HOME/.local/bin/engram" 2>/dev/null || true
fi

# codebase-memory-mcp, rtk, opencode, herdr now via nixpkgs (home/modules/packages.nix)

info "done"
