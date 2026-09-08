{ config, lib, pkgs, ... }:
{
  xdg.configFile."opencode/opencode.jsonc".source = ../../../config/opencode/opencode.jsonc;
  xdg.configFile."opencode/cli.json".source = ../../../config/opencode/cli.json;
  xdg.configFile."opencode/CONFIGURATION.md".source = ../../../config/opencode/CONFIGURATION.md;
  xdg.configFile."opencode/agents".source = ../../../config/opencode/agents;
  xdg.configFile."opencode/agents".recursive = true;

  # stdenv.cc.cc.lib kept so `LD_LIBRARY_PATH=/nix/store/.../lib:$LD_LIBRARY_PATH opencode` works for sharp/image tool.
  # DO NOT set home.sessionVariables.LD_LIBRARY_PATH globally — breaks KDE (libstdc++ mismatch).
  home.packages = with pkgs; [ stdenv.cc.cc.lib ];

  home.activation.opencodeBunInstall = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    # prefer upstream bun (~/.bun, see home/modules/upstream); nix bun only as bootstrap
    BUN_BIN="$HOME/.bun/bin/bun"
    if [ ! -x "$BUN_BIN" ]; then BUN_BIN="${pkgs.bun}/bin/bun"; fi
    export PATH="$HOME/.bun/bin:$PATH"
    echo "opencode: installing/updating @opencode-ai/cli@beta via bun (global)..."
    "$BUN_BIN" add -g @opencode-ai/cli@beta || echo "opencode: bun add -g failed (continuing)"
    mkdir -p "$HOME/.bun/bin"
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
  '';

  home.activation.opencodeSyncTools = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    if [ ! -e "$HOME/.config/opencode/tools/image.py" ]; then
      mkdir -p "$HOME/.config/opencode/tools"
      cp -a "$HOME/projects/dotfiles/config/opencode/tools/." "$HOME/.config/opencode/tools/"
      echo "opencode: copied tools from dotfiles"
    fi
  '';
}
