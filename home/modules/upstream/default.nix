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
  # - luvus: RizRiyz/luvus — official installer, replaces herdr (2026-09-23);
  #   re-running the installer updates the direct install in ~/.local/bin.
  # - omp: oh-my-pi — bun global install (config declarative via home/modules/omp).
  # - jev-mcp: TypeSafe Jev MCP server (OpenCode MCP entry; bin in ~/.bun/bin).
  # - engram: Gentleman-Programming/engram — persistent memory for AI coding
  #   agents (Go single binary; checksum-verified tarball -> ~/.local/bin).
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
    if is_upstream rtk; then
      info "updating rtk..."
    else
      info "installing rtk (rtk-ai)..."
    fi
    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh 2>&1 || warn "rtk install/update failed (continuing)"

    # engram: Gentleman-Programming/engram — persistent memory MCP server for
    # AI coding agents (MIT, Go single binary). Pinned to v3.0.0 (2026-10-01):
    # gnu/arm64 assets are published upstream, so the pinned tarball is
    # checksum-verified against the release checksums.txt before extraction and
    # installed to ~/.local/bin (mode 755). Re-running installs the pin.
    if is_upstream engram; then
      info "updating engram..."
    else
      info "installing engram (Gentleman-Programming)..."
    fi
    engram_tmp="$(mktemp -d)"
    engram_url="https://github.com/Gentleman-Programming/engram/releases/download/v3.0.0"
    engram_asset="engram_3.0.0_linux_amd64.tar.gz"
    if curl -fsSL -o "$engram_tmp/$engram_asset" "$engram_url/$engram_asset" \
       && curl -fsSL -o "$engram_tmp/checksums.txt" "$engram_url/checksums.txt"; then
      engram_expected="$(grep -F "  $engram_asset" "$engram_tmp/checksums.txt" | awk '{print $1}')"
      engram_actual="$(sha256sum "$engram_tmp/$engram_asset" | awk '{print $1}')"
      if [ -n "$engram_expected" ] && [ "$engram_expected" = "$engram_actual" ] \
         && tar -xzf "$engram_tmp/$engram_asset" -C "$engram_tmp" engram \
         && install -m 755 "$engram_tmp/engram" "$HOME/.local/bin/engram"; then
        info "engram v3.0.0 installed"
      else
        warn "engram checksum mismatch, extraction, or install failed (continuing)"
      fi
    else
      warn "engram download failed (continuing)"
    fi
    rm -rf "$engram_tmp"

    # luvus: RizRiyz/luvus — official installer (https://luvus.dev/install.sh).
    # Replaces herdr as the agent multiplexer (2026-09-23). LUVUS_INSTALL_DIR is
    # pinned: the installer prefers /usr/local/bin whenever that is writable, which
    # would drop the binary outside the user profile and outside is_upstream's
    # ~/.local/bin convention. Re-running the installer = update (same as rtk/engram);
    # `luvus update` also self-updates this direct install.
    if is_upstream luvus; then
      info "updating luvus..."
    else
      info "installing luvus (RizRiyz)..."
    fi
    curl -fsSL https://luvus.dev/install.sh | LUVUS_INSTALL_DIR="$HOME/.local/bin" sh 2>&1 || warn "luvus install/update failed (continuing)"

    # omp: oh-my-pi — bun global install (bin: omp). Config is declarative
    # (home/modules/omp copies ~/.omp/agent from config/omp); the binary comes
    # from upstream like opencode, since nixpkgs has no oh-my-pi package.
    if [ -x "$HOME/.bun/bin/bun" ]; then
      if is_upstream omp; then
        info "updating omp..."
      else
        info "installing omp (oh-my-pi)..."
      fi
      "$HOME/.bun/bin/bun" install -g --trust @oh-my-pi/pi-coding-agent@latest 2>&1 || warn "omp install/update failed (continuing)"
    else
      warn "bun missing — skipping omp"
    fi

    # jev-mcp: TypeSafe Jev decision layer as an MCP server (OpenCode MCP entry in
    # config/opencode/opencode.jsonc; bin: jev-mcp). Live judgments need
    # TYPESAFE_API_KEY (see .env.toml.example).
    if [ -x "$HOME/.bun/bin/bun" ]; then
      if is_upstream jev-mcp; then
        info "updating jev-mcp..."
      else
        info "installing jev-mcp (TypeSafe)..."
      fi
      "$HOME/.bun/bin/bun" install -g --trust jev-mcp@latest 2>&1 || warn "jev-mcp install/update failed (continuing)"
    else
      warn "bun missing — skipping jev-mcp"
    fi

    # cf: cloudflare/cf — Cloudflare's agent-oriented unified CLI (open beta
    # 2026-09-28; 3k+ API ops, JSON by default, `cf cli search`, `cf tools`
    # MCP dump). Not in nixpkgs (checked 2026-09-29: only the old
    # `cloudflare-cli` 5.x exists) — upstream install per policy. Bun global
    # like the other fast-moving tools; re-running installs latest upstream
    # (pin: cf@X.Y.Z). Needs system node >=22 (bin shim is `#!/usr/bin/env node`).
    if [ -x "$HOME/.bun/bin/bun" ]; then
      if is_upstream cf; then
        info "updating cf..."
      else
        info "installing cf (cloudflare/cf)..."
      fi
      "$HOME/.bun/bin/bun" install -g --trust cf@latest 2>&1 || warn "cf install/update failed (continuing)"
    else
      warn "bun missing — skipping cf"
    fi

    # never block switch
    true
  '';
}
