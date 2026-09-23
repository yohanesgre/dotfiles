{
  config,
  lib,
  pkgs,
  ...
}:
let
  # omp (oh-my-pi) keeps its user config in ~/.omp/agent — NOT under $XDG_CONFIG_HOME
  # (see omp://config-usage.md). The binary itself is installed by the upstream
  # installer (home/modules/upstream), like bun/rtk/opencode.
  #
  # top-level config documents omp reads; agents/ holds the subagent definitions
  #
  # MCP set (mcp.json, 2026-09-23): engram (memory, mounted) + codegraph
  # (codegraph serve --mcp, the successor of the removed codebase-memory-mcp —
  # omp's explorer/reviewer/swe skills already call codegraph_explore). playwright
  # is declared but omp silently drops browser MCPs while the native browser
  # prelude is enabled (omp://mcp-config.md). codegraph gets a 120s timeout
  # because its first call may sync the index and omp's default is 30s.
  files = [
    "config.yml"
    "mcp.json"
    "models.yml"
  ];
in
{
  # Copy, not symlink: omp WRITES these at runtime (settings.set() persists the
  # global config.yml — TUI model/theme/status-line changes; /mcp edits mcp.json),
  # so a /nix/store symlink would either fail the write or be replaced by a real
  # file. cmp-guarded copy keeps the repo authoritative and idempotent:
  # dotfiles win on every switch, so pull runtime edits back first
  # (cp ~/.omp/agent/config.yml ~/projects/dotfiles/config/omp/config.yml).
  # Runtime state in the same directory (agent.db, history.db, sessions/, blobs/,
  # cache/, skills/, extensions/) is NOT managed here — omp and the Luvus
  # integration own it.
  home.activation.ompSyncConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    SRC="$HOME/projects/dotfiles/config/omp"
    DST="$HOME/.omp/agent"
    if [ -d "$SRC" ]; then
      mkdir -p "$DST"
      for f in ${lib.concatStringsSep " " files}; do
        if [ -f "$SRC/$f" ] && { [ ! -f "$DST/$f" ] || ! cmp -s "$SRC/$f" "$DST/$f"; }; then
          $DRY_RUN_CMD cp -f "$SRC/$f" "$DST/$f"
          echo "omp: synced $f"
        fi
      done
      if [ -d "$SRC/agents" ]; then
        mkdir -p "$DST/agents"
        for a in "$SRC/agents"/*.md; do
          [ -f "$a" ] || continue
          b="$(basename "$a")"
          if [ ! -f "$DST/agents/$b" ] || ! cmp -s "$a" "$DST/agents/$b"; then
            $DRY_RUN_CMD cp -f "$a" "$DST/agents/$b"
            echo "omp: synced agents/$b"
          fi
        done
      fi
    fi
  '';

  # jev (TypeSafe) routing extension for omp. `omp install` materializes
  # ~/.omp/plugins (node_modules + omp-plugins.lock.json) — derived state, so the
  # repo records intent as the command rather than tracking the lockfile.
  # Judgments stay opt-in: the extension is disabled until `/jev enable`.
  home.activation.ompInstallJev = lib.hm.dag.entryAfter [ "writeBoundary" "upstreamInstall" ] ''
    OMP="$HOME/.bun/bin/omp"
    if [ -x "$OMP" ]; then
      if "$OMP" install omp-jev >/dev/null 2>&1; then
        echo "omp: omp-jev plugin installed/updated"
      else
        echo "omp: omp-jev install failed (continuing)" >&2
      fi
    else
      echo "omp: omp binary missing — skipping omp-jev" >&2
    fi
  '';
}
