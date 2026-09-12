{
  config,
  lib,
  pkgs,
  ...
}:
{
  # Fast-moving tools pinned to upstream installers, not nixpkgs.
  # Activation installs when missing and updates on every switch
  # (non-blocking: `|| warn`, offline switch still succeeds).
  # Evidence 2026-09-07 (nixpkgs rev 34ab990, `nix eval` on pinned flake):
  # - bun: nix 1.3.13 vs upstream 1.4.2 (2026-09-05) — full minor behind.
  #   Live ~/.bun/bin/bun already 1.4.2 via `bun upgrade` (clobbered nix shim).
  # - rtk: nix 0.45.0 vs upstream v0.48.0 (2026-09-04) — 3 releases behind.
  # - codegraph: colbymchenry/codegraph — bun global install (OpenCode MCP); reinstalled
  #   on every switch.
  # - herdr: nix 0.8.2 == upstream stable today, but `herdr update` self-update
  #   only works on direct installs (Nix installs must update via Nix).
  # Stable CLI (git/curl/jq/rg/fd/fzf/bat/eza/zoxide/nodejs/go/neovim/tmux)
  # comes from pacman/CachyOS since 2026-09-07 — see home/modules/pacman
  # (no nixpkgs packages in the profile).
  home.activation.upstreamInstall = lib.hm.dag.entryAfter [ "installPackages" ] ''
    set -u
    # installers need full unix plumbing (awk/tar/sha256sum/unzip) — HM activation PATH is minimal
    export PATH="${pkgs.curl}/bin:${pkgs.git}/bin:${pkgs.gawk}/bin:${pkgs.gnutar}/bin:${pkgs.gzip}/bin:${pkgs.coreutils}/bin:${pkgs.gnugrep}/bin:${pkgs.gnused}/bin:${pkgs.unzip}/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/go/bin:$PATH"
    export BUN_INSTALL="$HOME/.bun"
    mkdir -p "$HOME/.bun/bin" "$HOME/.local/bin"

    warn() { echo "upstreamInstall: $*" >&2; }
    info() { echo "upstreamInstall: $*"; }
    # leftovers of deleted bunShim (packages.nix): symlinks into /nix/store
    # that would shadow upstream binaries or dangle after profile rebuild.
    for link in "$HOME/.local/bin/node" "$HOME/.local/bin/npm" "$HOME/.local/bin/npx" "$HOME/.local/bin/bunx" "$HOME/.bun/bin/bunx"; do
      if [ -L "$link" ] && case "$(readlink -f "$link" 2>/dev/null || echo "")" in /nix/store/*) true;; *) false;; esac; then
        info "removing stale nix symlink $link"
        rm -f "$link"
      fi
    done

    # true if cmd exists, is executable, and resolves outside /nix/store
    # (i.e. upstream-managed, not nix)
    is_upstream() {
      local bin resolved
      bin="$(command -v "$1" 2>/dev/null || true)"
      [ -n "$bin" ] || return 1
      resolved="$(readlink -f "$bin" 2>/dev/null || echo "$bin")"
      [ -x "$resolved" ] || return 1
      case "$resolved" in /nix/store/*) return 1;; *) return 0;; esac
    }

    # bun: oven-sh/bun — official installer (https://bun.sh/install).
    # Nix shim removed: `bun upgrade` replaces the symlink with a real binary,
    # so the shim never survives. Upstream owns ~/.bun natively.
    if [ -L "$HOME/.bun/bin/bun" ]; then
      info "removing stale nix bun shim (replaced by upstream install)..."
      rm -f "$HOME/.bun/bin/bun" "$HOME/.bun/bin/bunx"
    fi
    if is_upstream bun; then
      info "updating bun..."
      bun upgrade 2>&1 || warn "bun upgrade failed (continuing)"
    else
      info "installing bun (oven-sh/bun)..."
      curl -fsSL https://bun.sh/install | bash 2>&1 || warn "bun install failed (continuing)"
    fi

    # codegraph: colbymchenry/codegraph — bun global install (OpenCode MCP).
    if [ -x "$HOME/.bun/bin/bun" ]; then
      if is_upstream codegraph; then
        info "updating codegraph..."
      else
        info "installing codegraph (colbymchenry)..."
      fi
      "$HOME/.bun/bin/bun" install -g --trust @colbymchenry/codegraph 2>&1 || warn "codegraph install/update failed (continuing)"
    else
      warn "bun missing — skipping codegraph"
    fi

    # rtk: rtk-ai/rtk — official installer (checksum-verified, -> ~/.local/bin).
    # Re-running install.sh fetches latest (pin via RTK_VERSION=vX.Y.Z).
    # NOTE: rtk-mcp (MCP server, ~/.local/bin/rtk-mcp) is a separate binary,
    # already manual since 2026-09-06 — left untouched here.
    if is_upstream rtk; then
      info "updating rtk..."
    else
      info "installing rtk (rtk-ai)..."
    fi
    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh 2>&1 || warn "rtk install/update failed (continuing)"

    # herdr: herdrdev/herdr — official installer (https://herdr.dev/install.sh).
    if is_upstream herdr; then
      info "updating herdr..."
      herdr update 2>&1 || warn "herdr update failed (continuing)"
    else
      info "installing herdr (herdrdev)..."
      curl -fsSL https://herdr.dev/install.sh | sh 2>&1 || warn "herdr install failed (continuing)"
    fi

    # never block switch
    true
  '';
}
