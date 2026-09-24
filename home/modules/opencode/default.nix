{
  config,
  lib,
  pkgs,
  ...
}:
{
  xdg.configFile."opencode/opencode.jsonc".source = ../../../config/opencode/opencode.jsonc;
  xdg.configFile."opencode/AGENTS.md".source = ../../../config/opencode/AGENTS.md;
  xdg.configFile."opencode/CONFIGURATION.md".source = ../../../config/opencode/CONFIGURATION.md;
  xdg.configFile."opencode/agents".source = ../../../config/opencode/agents;
  xdg.configFile."opencode/agents".recursive = true;
  xdg.configFile."opencode/commands".source = ../../../config/opencode/commands;
  xdg.configFile."opencode/commands".recursive = true;
  xdg.configFile."opencode/browser-use-llm-proxy.py".source =
    ../../../config/opencode/browser-use-llm-proxy.py;

  # stdenv.cc.cc.lib kept so `LD_LIBRARY_PATH=/nix/store/.../lib:$LD_LIBRARY_PATH opencode` works for sharp/image tool.
  # DO NOT set home.sessionVariables.LD_LIBRARY_PATH globally — breaks KDE (libstdc++ mismatch).
  home.packages = with pkgs; [
    stdenv.cc.cc.lib
    # browser-use MCP wrapper: reads the key file directly instead of an
    # {env:...} indirection, so an empty key in the daemonized service env can
    # no longer poison the MCP child. Version pin lives here.
    (pkgs.writeShellScriptBin "browser-use-mcp" ''
      if [ -r "$HOME/.config/browser-use/key" ]; then
        OPENAI_API_KEY="$(cat "$HOME/.config/browser-use/key")"
        export OPENAI_API_KEY
      fi
      exec uvx --from 'browser-use[cli]==0.13.10' browser-use --mcp
    '')
  ];

  home.activation.opencodeBunInstall = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    # prefer upstream bun (~/.bun, see home/modules/upstream); nix bun only as bootstrap
    BUN_BIN="$HOME/.bun/bin/bun"
    if [ ! -x "$BUN_BIN" ]; then BUN_BIN="${pkgs.bun}/bin/bun"; fi
    export PATH="$HOME/.bun/bin:$PATH"
    echo "opencode: installing/updating @opencode/cli@latest via bun (global)..."
    "$BUN_BIN" install -g --trust @opencode/cli@latest || echo "opencode: bun install -g failed (continuing)"
    mkdir -p "$HOME/.bun/bin"
  '';

  # cli.json is the TUI config, and it is NOT read-only: `luvus integration install
  # opencode` rewrites it to register its TUI plugin (./luvus-v2). A /nix/store
  # symlink would be replaced by a real file on that write, and the next switch
  # would then move the real file to .backup — churn every time. Copy instead
  # (cmp-guarded, dotfiles win), same pattern as the plugins below.
  home.activation.opencodeSyncCliJson = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    SRC="$HOME/projects/dotfiles/config/opencode/cli.json"
    DST="$HOME/.config/opencode/cli.json"
    if [ -f "$SRC" ] && { [ ! -f "$DST" ] || ! cmp -s "$SRC" "$DST"; }; then
      $DRY_RUN_CMD cp -f "$SRC" "$DST"
      echo "opencode: synced cli.json"
    fi
  '';

  # Plugin must be real mutable files (not nix-store symlinks): bun resolves
  # imports from file realpath, so node_modules next to a nix-store copy is
  # never consulted. opencodeSyncPlugins copies it from dotfiles on every
  # switch, preserving node_modules across recopies.
  home.activation.opencodeSyncPlugins = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    BUN_BIN="$HOME/.bun/bin/bun"
    if [ ! -x "$BUN_BIN" ]; then BUN_BIN="${pkgs.bun}/bin/bun"; fi
    SRC="$HOME/projects/dotfiles/config/opencode/plugins/opencode-subagents"
    DST="$HOME/.config/opencode/plugins/opencode-subagents"
    if [ -d "$SRC" ]; then
      mkdir -p "$HOME/.config/opencode/plugins"
      NODE_MODULES_TMP="$HOME/.config/opencode/plugins/.opencode-subagents-node_modules-tmp"
      HAD_NODE_MODULES=0
      if [ -d "$DST/node_modules" ]; then
        HAD_NODE_MODULES=1
        rm -rf "$NODE_MODULES_TMP"
        mv "$DST/node_modules" "$NODE_MODULES_TMP"
      fi
      rm -rf "$DST"
      cp -a "$SRC" "$DST"
      rm -rf "$DST/node_modules" "$DST/bun.lock"
      if [ "$HAD_NODE_MODULES" = 1 ]; then
        mv "$NODE_MODULES_TMP" "$DST/node_modules"
      fi
      echo "opencode: synced opencode-subagents plugin from dotfiles"
      if [ -f "$DST/package.json" ] && [ ! -d "$DST/node_modules" ]; then
        echo "opencode: installing plugin deps via bun..."
        (cd "$DST" && "$BUN_BIN" install) \
          && echo "opencode: plugin deps installed" \
          || echo "opencode: bun install for plugin failed (continuing)"
      fi
    fi

    # opencode-go-limit TUI plugin: renders JSX in the TUI, so it needs its
    # node_modules next to the real files for the same reason as above.
    SRC="$HOME/projects/dotfiles/config/opencode/plugins/opencode-go-limit"
    DST="$HOME/.config/opencode/plugins/opencode-go-limit"
    if [ -d "$SRC" ]; then
      mkdir -p "$HOME/.config/opencode/plugins"
      NODE_MODULES_TMP="$HOME/.config/opencode/plugins/.opencode-go-limit-node_modules-tmp"
      HAD_NODE_MODULES=0
      if [ -d "$DST/node_modules" ]; then
        HAD_NODE_MODULES=1
        rm -rf "$NODE_MODULES_TMP"
        mv "$DST/node_modules" "$NODE_MODULES_TMP"
      fi
      rm -rf "$DST"
      cp -a "$SRC" "$DST"
      rm -rf "$DST/node_modules" "$DST/bun.lock"
      if [ "$HAD_NODE_MODULES" = 1 ]; then
        mv "$NODE_MODULES_TMP" "$DST/node_modules"
      fi
      echo "opencode: synced opencode-go-limit plugin from dotfiles"
      if [ -f "$DST/package.json" ] && [ ! -d "$DST/node_modules" ]; then
        echo "opencode: installing opencode-go-limit plugin deps via bun..."
        (cd "$DST" && "$BUN_BIN" install) \
          && echo "opencode: opencode-go-limit plugin deps installed" \
          || echo "opencode: bun install for opencode-go-limit plugin failed (continuing)"
      fi
    fi

    # rtk auto-rewrite plugin: standalone (zero runtime imports; uses the global
    # `Bun`). Copied as a real file for the same reason as above.
    RTK_SRC="$HOME/projects/dotfiles/config/opencode/plugins/rtk.ts"
    if [ -f "$RTK_SRC" ]; then
      mkdir -p "$HOME/.config/opencode/plugins"
      cp -a "$RTK_SRC" "$HOME/.config/opencode/plugins/rtk.ts"
      echo "opencode: synced rtk rewrite plugin from dotfiles"
    fi
  '';

  home.activation.opencodeSyncIcmPlugin = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    SRC="$HOME/projects/dotfiles/config/opencode/plugins/icm.ts"
    DST="$HOME/.config/opencode/plugins/icm.ts"
    if [ -f "$SRC" ]; then
      mkdir -p "$HOME/.config/opencode/plugins"
      if ! cmp -s "$SRC" "$DST"; then
        cp -f "$SRC" "$DST"
        echo "opencode: synced icm plugin"
      fi
    fi
  '';

  # gh plugin: read-only GitHub tools wrapping the authenticated `gh` CLI.
  # Sourced from the flake store path (not $HOME/projects/dotfiles) so it
  # deploys correctly from any checkout or worktree.
  home.activation.opencodeSyncGhPlugin = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    GH_SRC="${../../../config/opencode/plugins/gh.ts}"
    GH_DST="$HOME/.config/opencode/plugins/gh.ts"
    if [ -f "$GH_SRC" ]; then
      mkdir -p "$HOME/.config/opencode/plugins"
      if ! cmp -s "$GH_SRC" "$GH_DST"; then
        cp -f "$GH_SRC" "$GH_DST"
        echo "opencode: synced gh plugin"
      fi
    fi
  '';

  # Shared warm embedding daemon for the icm OpenCode plugin tools (icm.ts):
  # `icm serve --http` loads the embedding model + SQLite store once and keeps
  # them warm across requests. The plugin routes heavy semantic ops
  # (store/recall/consolidate/stats/topics/health) to this daemon and shells out
  # to the `icm` CLI for cheap/occasional ops — replacing the old `icm` MCP server.
  systemd.user.services.icm-http = {
    Unit = {
      Description = "ICM HTTP daemon — shared warm embedding model for OpenCode plugin tools";
    };
    Service = {
      ExecStart = "%h/.local/bin/icm serve --http 127.0.0.1:11435";
      Restart = "on-failure";
      RestartSec = 3;
    };
    Install = {
      WantedBy = [ "default.target" ];
    };
  };

  # browser-use LLM proxy: OpenCode Go rejects external clients missing the
  # `x-opencode-session` header, and browser-use cannot set custom headers.
  # This stdlib-only localhost proxy injects a stable session id per process.
  systemd.user.services.browser-use-llm-proxy = {
    Unit = {
      Description = "Localhost proxy adding x-opencode-session for browser-use → OpenCode Go";
    };
    Service = {
      ExecStart = "${pkgs.python3}/bin/python3 %h/.config/opencode/browser-use-llm-proxy.py";
      Restart = "on-failure";
      RestartSec = 3;
    };
    Install = {
      WantedBy = [ "default.target" ];
    };
  };

  home.activation.opencodeSyncTools = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    if [ ! -e "$HOME/.config/opencode/tools/image.py" ]; then
      mkdir -p "$HOME/.config/opencode/tools"
      cp -a "$HOME/projects/dotfiles/config/opencode/tools/." "$HOME/.config/opencode/tools/"
      echo "opencode: copied tools from dotfiles"
    fi
  '';
}
