#!/usr/bin/env bash
set -euo pipefail

warn() { echo "install-manual: $*" >&2; }
info() { echo "install-manual: $*"; }

# engram: ~/go/bin/engram or ~/.local/bin/engram — not in nixpkgs, kept manual
if [ ! -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ]; then
  info "installing engram..."
  if command -v go >/dev/null 2>&1; then
    go install github.com/engramhq/engram@latest 2>&1 || warn "go install engram failed"
  else
    warn "go not in PATH — skipping go install engram"
  fi
else
  info "engram already present — skipping"
fi

# codebase-memory-mcp, rtk, opencode, herdr now via nixpkgs (home/modules/packages.nix)
# omp via flake inputs.omp — not manual. No curl fallback needed.

info "done"
