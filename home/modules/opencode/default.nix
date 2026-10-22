{
  config,
  lib,
  pkgs,
  ...
}:
let
  # Peer-scoped OpenCode service (`opencode-peer-serve` below). The omp `opencode_peer`
  # extension aims its `opencode run` at this server instead of the shared background
  # service, so these free-tier subagent pins apply to peer-spawned subagents ONLY.
  #
  # Why a separate service: agent definitions resolve in the server that LOADS the config,
  # not in the client that sets OPENCODE_CONFIG_CONTENT. Pointing the shared service at
  # these pins repins the user's own opencode harness and panes too — measured, not assumed.
  #
  # Pins are static: no jev or any other judgment runs at runtime. Both the model mix and
  # the reasoning effort were triaged with jev_classify on 2026-10-16 — the effort pass
  # returned 3 max / 3 high / 3 low, 8 auto plus `designer` flagged for review and accepted
  # on a 0.56 margin. `#low|#high|#max` is reasoning effort, not a model id.
  peerSubagentPins = {
    architect = "opencode/glm-5.3-flash-free#max";
    reviewer = "opencode/glm-5.3-flash-free#max";
    designer = "opencode/glm-5.3-flash-free#max";
    swe = "opencode/deepseek-v4.1-flash-free#high";
    researcher = "opencode/deepseek-v4.1-flash-free#high";
    general = "opencode/deepseek-v4.1-flash-free#high";
    steward = "opencode/deepseek-v4.1-flash-free#low";
    vision = "opencode/deepseek-v4.1-flash-free#low";
    explore = "opencode/deepseek-v4.1-flash-free#low";
  };

  # OPENCODE_CONFIG_CONTENT merges over the on-disk config, so only the agents named here
  # change: MCP servers, permissions and the user's own agent pins all stay intact.
  peerConfigContent = builtins.toJSON {
    agents = lib.mapAttrs (_: model: { inherit model; }) peerSubagentPins;
  };

  # Loopback-only service password, shared with the extension. Not a credential to protect
  # (the port is bound to 127.0.0.1 and any local process could reach it anyway); it exists
  # so the peer client authenticates deterministically instead of parsing a random password.
  peerPassword = "omp-peer-loopback-7f3c1d90b2";
in
{
  xdg.configFile."opencode/opencode.jsonc".source = ../../../config/opencode/opencode.jsonc;
  xdg.configFile."opencode/AGENTS.md".source = ../../../config/opencode/AGENTS.md;
  xdg.configFile."opencode/CONFIGURATION.md".source = ../../../config/opencode/CONFIGURATION.md;
  xdg.configFile."opencode/agents".source = ../../../config/opencode/agents;
  xdg.configFile."opencode/agents".recursive = true;
  xdg.configFile."opencode/commands".source = ../../../config/opencode/commands;
  xdg.configFile."opencode/commands".recursive = true;

  # Peer-scoped config for `opencode-peer-serve`: merges over the user's config with only the
  # free-tier subagent pins changed. Passed to the server by PATH (OPENCODE_CONFIG), never by
  # value: systemd's Environment= parsing strips the double quotes out of a JSON value, so
  # `OPENCODE_CONFIG_CONTENT={"agents":…}` reaches the process as invalid JSON and is ignored.
  xdg.configFile."opencode/peer-config.json".text = peerConfigContent;

  # stdenv.cc.cc.lib kept so `LD_LIBRARY_PATH=/nix/store/.../lib:$LD_LIBRARY_PATH opencode` works for sharp/image tool.
  # DO NOT set home.sessionVariables.LD_LIBRARY_PATH globally — breaks KDE (libstdc++ mismatch).
  home.packages = with pkgs; [
    stdenv.cc.cc.lib
    # jev-mcp wrapper: @jkudish/jev-mcp reads its key ONLY from the environment
    # (TYPESAFE_API_KEY / JEV_API_KEY) — unlike the older rashedInt32 build it has
    # no key-file fallback. This exports the key from ~/.config/typesafe/key
    # (0600, written by home/modules/env) into the child only, so the daemonized
    # clients (opencode service, codex, omp) never depend on TYPESAFE_API_KEY
    # being present in their own process env. Absolute exec path: ~/.bun/bin is
    # not guaranteed on every spawner's PATH. Referenced by opencode.jsonc, the
    # codex module, and config/omp/mcp.json.
    (pkgs.writeShellScriptBin "jev-mcp-keyfile" ''
      if [ -r "$HOME/.config/typesafe/key" ]; then
        TYPESAFE_API_KEY="$(cat "$HOME/.config/typesafe/key")"
        export TYPESAFE_API_KEY
      fi
      exec "$HOME/.bun/bin/jev-mcp" "$@"
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

  # engram plugin: OpenCode event adapter for the engram HTTP server, vendored
  # byte-for-byte from upstream v3.5.2 (type-only @opencode-ai/plugin import,
  # zero runtime deps). Sourced from the flake store path (not
  # $HOME/projects/dotfiles) so it deploys from any checkout or worktree —
  # same pattern as the gh plugin below.
  home.activation.opencodeSyncEngramPlugin = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    mkdir -p "$HOME/.config/opencode/plugins"
    # drop the replaced icm plugin (stale real file copied by the removed
    # opencodeSyncIcmPlugin activation) so OpenCode never loads both adapters
    if [ -e "$HOME/.config/opencode/plugins/icm.ts" ]; then
      rm -f "$HOME/.config/opencode/plugins/icm.ts"
      echo "opencode: removed stale icm plugin"
    fi
    ENGRAM_SRC="${../../../config/opencode/plugins/engram.ts}"
    ENGRAM_DST="$HOME/.config/opencode/plugins/engram.ts"
    if [ -f "$ENGRAM_SRC" ]; then
      if ! cmp -s "$ENGRAM_SRC" "$ENGRAM_DST"; then
        cp -f "$ENGRAM_SRC" "$ENGRAM_DST"
        echo "opencode: synced engram plugin"
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

  # Engram local HTTP server (127.0.0.1:7437) — the single supervised server
  # instance the OpenCode plugin adopts (auto-starts one if absent, but a
  # systemd-managed server survives plugin reloads and keeps one shared SQLite
  # store warm across sessions). `engram mcp` (opencode.jsonc) is the stdio
  # adapter the agent's mem_* tools talk to.
  systemd.user.services.engram-serve = {
    Unit = {
      Description = "Engram memory HTTP server — local persistent memory for AI agents";
    };
    Service = {
      ExecStart = "%h/.local/bin/engram serve";
      Restart = "on-failure";
      RestartSec = 3;
    };
    Install = {
      WantedBy = [ "default.target" ];
    };
  };

  # Peer-scoped OpenCode server for the omp `opencode_peer` extension (fixed port 49375,
  # loopback only). It carries peerSubagentPins, so peer-spawned subagents run on the free
  # tier while the shared background service — and therefore the user's own harness and
  # Luvus panes — keeps the config-file pins. The extension connects with
  # `opencode run --server http://127.0.0.1:49375` plus OPENCODE_PASSWORD=peerPassword.
  systemd.user.services.opencode-peer-serve = {
    Unit = {
      Description = "OpenCode peer server — free-tier agent pins for omp peer runs";
    };
    Service = {
      ExecStart = "%h/.bun/bin/opencode serve --hostname 127.0.0.1 --port 49375";
      Environment = [
        "OPENCODE_PASSWORD=${peerPassword}"
        "OPENCODE_CONFIG=%h/.config/opencode/peer-config.json"
      ];
      Restart = "on-failure";
      RestartSec = 3;
    };
    Install = {
      WantedBy = [ "default.target" ];
    };
  };

  # Nothing in the activation chain restarts a unit whose definition changed, and the unit
  # reads its pins from a generated file, so a pin edit would land in the store and never
  # reach the running server (hit 2026-10-16: the unit kept the old, quote-stripped env).
  # Re-apply explicitly. The restart is cheap — this server only serves omp peer runs.
  home.activation.opencodePeerServeReload =
    lib.hm.dag.entryAfter [ "writeBoundary" "reloadSystemd" ]
      ''
        if systemctl --user is-active --quiet opencode-peer-serve.service; then
          $DRY_RUN_CMD systemctl --user daemon-reload
          $DRY_RUN_CMD systemctl --user restart opencode-peer-serve.service
          echo "opencode: restarted opencode-peer-serve (peer subagent pins re-applied)"
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
