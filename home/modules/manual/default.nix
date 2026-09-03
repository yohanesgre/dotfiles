{ config, lib, pkgs, ... }:
{
  home.activation.manualInstall = lib.hm.dag.entryAfter [ "installPackages" ] ''
    set -u
    export PATH="${pkgs.go}/bin:${pkgs.git}/bin:$PATH"
    export GOPATH="$HOME/go"
    export GOBIN="$HOME/go/bin"
    mkdir -p "$GOBIN" "$HOME/.local/bin"

    warn() { echo "manualInstall: $*" >&2; }
    info() { echo "manualInstall: $*"; }

    # engram: Gentleman-Programming/engram (Go, not in nixpkgs)
    if [ ! -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ]; then
      info "installing engram (Gentleman-Programming)..."
      if [ -x "${pkgs.go}/bin/go" ]; then
        ${pkgs.go}/bin/go install github.com/Gentleman-Programming/engram/cmd/engram@latest 2>&1 || warn "go install engram failed (continuing)"
        if [ -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ]; then
          ln -sf "$HOME/go/bin/engram" "$HOME/.local/bin/engram" 2>/dev/null || true
        fi
      else
        warn "go not found at ${pkgs.go}/bin/go — skipping"
      fi
      if [ ! -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ]; then
        warn "engram still missing after go install — check https://github.com/Gentleman-Programming/engram"
      fi
    else
      info "engram already installed"
      # ensure symlink
      if [ -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ]; then
        ln -sf "$HOME/go/bin/engram" "$HOME/.local/bin/engram" 2>/dev/null || true
      fi
    fi

    # codebase-memory-mcp, rtk, herdr now via nixpkgs home.packages (migrated 2026-08-31)
    # opencode moved to bun (opencode-ai) via home/modules/opencode (nixpkgs lags behind)

    # never block switch
    true
  '';
}
