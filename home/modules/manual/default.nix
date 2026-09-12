{
  config,
  lib,
  pkgs,
  ...
}:
{
  home.activation.manualInstall = lib.hm.dag.entryAfter [ "installPackages" ] ''
    set -u
    # go from pacman (see home/modules/pacman) — not nixpkgs
    export PATH="/usr/bin:/usr/local/bin:$PATH"
    export GOPATH="$HOME/go"
    export GOBIN="$HOME/go/bin"
    mkdir -p "$GOBIN" "$HOME/.local/bin"

    warn() { echo "manualInstall: $*" >&2; }
    info() { echo "manualInstall: $*"; }

    # engram: Gentleman-Programming/engram (Go, not in nixpkgs) — update on every switch
    GO_BIN="$(command -v go 2>/dev/null || true)"
    if [ -n "$GO_BIN" ]; then
      info "installing/updating engram (Gentleman-Programming)..."
      "$GO_BIN" install github.com/Gentleman-Programming/engram/cmd/engram@latest 2>&1 || warn "go install engram failed (continuing)"
      if [ -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ]; then
        ln -sf "$HOME/go/bin/engram" "$HOME/.local/bin/engram" 2>/dev/null || true
      fi
    else
      warn "go not found in PATH — run: sudo pacman -S go"
    fi
    if [ ! -x "$HOME/go/bin/engram" ] && [ ! -x "$HOME/.local/bin/engram" ]; then
      warn "engram still missing after go install — check https://github.com/Gentleman-Programming/engram"
    fi

    # bun / codegraph / rtk / herdr via upstream installers (home/modules/upstream)
    # opencode via bun (home/modules/opencode)

    # never block switch
    true
  '';
}
