{ config, lib, pkgs, ... }:
{
  home.activation.manualInstall = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    set -u

    warn() { echo "manualInstall: $*" >&2; }
    info() { echo "manualInstall: $*"; }

    # engram: ~/go/bin/engram or ~/.local/bin/engram — not in nixpkgs (404), keep manual
    if [ ! -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ]; then
      info "installing engram (missing)..."
      if command -v go >/dev/null 2>&1; then
        go install github.com/engramhq/engram@latest 2>&1 || warn "go install engram failed (continuing)"
      else
        warn "go not in PATH — skipping go install engram"
      fi
      if [ ! -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ]; then
        warn "engram still missing after go install (network/auth?) — continuing"
      fi
    fi

    # codebase-memory-mcp, rtk, opencode, herdr now via nixpkgs home.packages (migrated 2026-08-31)

    # never block switch
    true
  '';
}
