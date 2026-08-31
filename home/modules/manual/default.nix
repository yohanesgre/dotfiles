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

    # engram: not in nixpkgs, upstream go install broken (repo has no go.mod at root, 2026-08-31)
    # was: go install github.com/engramhq/engram@latest -> fails "does not contain package"
    # keep as manual stub, skip auto-install until upstream provides installable package
    if [ ! -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ]; then
      warn "engram not in nixpkgs and go install path invalid (github.com/engramhq/engram has no go.mod) — skipping auto-install"
      warn "install manually if needed: check https://github.com/engramhq/engram or ~/projects/dotfiles/config/engram/"
    else
      info "engram already installed"
    fi

    # codebase-memory-mcp, rtk, opencode, herdr now via nixpkgs home.packages (migrated 2026-08-31)

    # never block switch
    true
  '';
}
