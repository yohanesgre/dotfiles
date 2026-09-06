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
    export PATH="${pkgs.bun}/bin:$HOME/.bun/bin:$PATH"
    if [ ! -x "$HOME/.bun/install/global/node_modules/@opencode-ai/cli/bin/opencode2.exe" ]; then
      echo "opencode: installing @opencode-ai/cli@beta via bun (global)..."
      ${pkgs.bun}/bin/bun add -g @opencode-ai/cli@beta || echo "opencode: bun add -g failed (continuing)"
    else
      echo "opencode: @opencode-ai/cli already installed via bun"
    fi
    mkdir -p "$HOME/.bun/bin"
  '';

  # Plugins removed 2026-09-06 (archived, see CONFIGURATION.md) — only sync
  # the remaining custom tool(s) from dotfiles.
  home.activation.opencodeSyncTools = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    if [ ! -e "$HOME/.config/opencode/tools/image.py" ]; then
      mkdir -p "$HOME/.config/opencode/tools"
      cp -a "$HOME/projects/dotfiles/config/opencode/tools/." "$HOME/.config/opencode/tools/"
      echo "opencode: copied tools from dotfiles"
    fi
  '';
}
