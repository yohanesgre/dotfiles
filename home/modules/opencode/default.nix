{ config, lib, pkgs, ... }:
{
  xdg.configFile."opencode/opencode.jsonc".source = ../../../config/opencode/opencode.jsonc;
  xdg.configFile."opencode/cli.json".source = ../../../config/opencode/cli.json;
  xdg.configFile."opencode/dcp.jsonc".source = ../../../config/opencode/dcp.jsonc;
  xdg.configFile."opencode/tui.json".source = ../../../config/opencode/tui.json;
  xdg.configFile."opencode/CONFIGURATION.md".source = ../../../config/opencode/CONFIGURATION.md;
  xdg.configFile."opencode/oh-my-opencode-slim.json".source = ../../../config/opencode/oh-my-opencode-slim.json;
  xdg.configFile."opencode/agents".source = ../../../config/opencode/agents;
  xdg.configFile."opencode/agents".recursive = true;
  xdg.configFile."opencode/skills".source = ../../../config/opencode/skills;
  xdg.configFile."opencode/skills".recursive = true;

  # stdenv.cc.cc.lib kept so `LD_LIBRARY_PATH=/nix/store/.../lib:$LD_LIBRARY_PATH opencode` works for sharp/image tool.
  # DO NOT set home.sessionVariables.LD_LIBRARY_PATH globally — breaks KDE (libstdc++ mismatch).
  home.packages = with pkgs; [ stdenv.cc.cc.lib ];

  home.activation.opencodeBunInstall = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    export PATH="${pkgs.bun}/bin:$HOME/.bun/bin:$PATH"
    if ! ${pkgs.bun}/bin/bun pm -g ls 2>/dev/null | grep -q "opencode-ai"; then
      echo "opencode: installing opencode-ai via bun (global)..."
      ${pkgs.bun}/bin/bun add -g opencode-ai || echo "opencode: bun add -g failed (continuing)"
      # bun blocks postinstall by default — ensure native binary is built
      if [ -f "$HOME/.bun/install/global/node_modules/opencode-ai/postinstall.mjs" ]; then
        node "$HOME/.bun/install/global/node_modules/opencode-ai/postinstall.mjs" 2>/dev/null || true
      fi
    else
      echo "opencode: opencode-ai already installed via bun"
      # ensure postinstall was run (fixes --ignore-scripts or blocked postinstall)
      if [ ! -x "$HOME/.bun/install/global/node_modules/opencode-ai/bin/opencode.exe" ] && [ -f "$HOME/.bun/install/global/node_modules/opencode-ai/postinstall.mjs" ]; then
        node "$HOME/.bun/install/global/node_modules/opencode-ai/postinstall.mjs" 2>/dev/null || true
      fi
    fi
    mkdir -p "$HOME/.bun/bin"
  '';

  home.activation.opencodeFixPlugins = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    # Fix plugin/tool symlinks -> real files so bun can resolve node_modules
    for p in "$HOME/.config/opencode/plugins" "$HOME/.config/opencode/tools"; do
      [ -e "$p" ] || continue
      if [ -L "$p" ]; then
        rm -rf "$p"
      fi
    done
    for f in "$HOME/.config/opencode/plugins"/* "$HOME/.config/opencode/tools"/*; do
      [ -e "$f" ] || continue
      if [ -L "$f" ]; then
        target=$(readlink -f "$f")
        rm "$f"
        cp -a "$target" "$f"
        echo "opencode: restored $f"
      fi
    done
    if [ ! -e "$HOME/.config/opencode/plugins/engram.ts" ]; then
      mkdir -p "$HOME/.config/opencode/plugins"
      cp -a "$HOME/projects/dotfiles/config/opencode/plugins/." "$HOME/.config/opencode/plugins/"
      echo "opencode: copied plugins from dotfiles"
    fi
    if [ ! -e "$HOME/.config/opencode/tools/image.ts" ]; then
      mkdir -p "$HOME/.config/opencode/tools"
      cp -a "$HOME/projects/dotfiles/config/opencode/tools/." "$HOME/.config/opencode/tools/"
      echo "opencode: copied tools from dotfiles"
    fi
    if [ -d "$HOME/.config/opencode/plugins/kdco-primitives" ] && [ -L "$HOME/.config/opencode/plugins/kdco-primitives" ]; then
      target=$(readlink -f "$HOME/.config/opencode/plugins/kdco-primitives")
      rm "$HOME/.config/opencode/plugins/kdco-primitives"
      cp -a "$target" "$HOME/.config/opencode/plugins/kdco-primitives"
    fi
    for kd in "$HOME/.config/opencode/plugins/kdco-primitives"/*; do
      [ -e "$kd" ] || continue
      [ -L "$kd" ] && { t=$(readlink -f "$kd"); rm "$kd"; cp -a "$t" "$kd"; }
    done
    if [ ! -d "$HOME/.config/opencode/node_modules/@opencode-ai/plugin" ]; then
      echo "opencode: bun install"
      (cd "$HOME/.config/opencode" && ${pkgs.bun}/bin/bun install --silent || true)
    fi
  '';
}
