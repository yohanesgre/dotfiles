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
  # top-level config documents omp reads; agents/ holds the subagent definitions;
  # extensions/ holds our OMP extension modules and skills/ our OMP-only skills
  # (both dirs are shared — luvus.ts and skills/luvus are owned by the luvus
  # integration, so only our files are copied, nothing is pruned)
  #
  # MCP set (mcp.json): codegraph
  # (codegraph serve --mcp, the successor of the removed codebase-memory-mcp —
  # omp's explorer/reviewer/swe skills already call codegraph_explore). playwright
  # is declared but omp silently drops browser MCPs while the native browser
  # prelude is enabled (omp://mcp-config.md). codegraph gets a 120s timeout
  # because its first call may sync the index and omp's default is 30s.
  # jev-mcp (@jkudish/jev-mcp, 12 judgment tools) is reached through the
  # `jev-mcp-keyfile` wrapper (home/modules/opencode) so opencode, codex and omp
  # share one key path (~/.config/typesafe/key) — same server name
  # as opencode's entry, so the tool surface is identical across clients.
  # engram (Gentleman-Programming/engram) is omp's memory layer, same as
  # opencode: the `engram` MCP entry (`mem_*` tools) talks to the shared
  # `engram-serve` systemd user service on 127.0.0.1:7437. omp's OWN memory
  # backends stay off (config.yml: memory.backend "off", memories.enabled false).
  #
  # models.yml: override-only provider config (omp://models.md). Removed
  # 2026-10-11 when its sole custom provider (gmi-cloud) was retired, then
  # restored the same day to cap `commandcode` free-tier models at the gateway's
  # 32768 max_tokens — omp's catalog rows advertise up to 66K, so requests
  # otherwise fail `400 INVALID_REQUEST_BODY: max_tokens ... must be between 0
  # and 32768`. modelRoles is intentionally unset (omp role defaults apply).
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
      # Our extension modules only — the same dir also holds luvus.ts, which the
      # luvus integration installs and refreshes on its own schedule.
      if [ -d "$SRC/extensions" ]; then
        mkdir -p "$DST/extensions"
        for e in "$SRC/extensions"/*.ts; do
          [ -f "$e" ] || continue
          b="$(basename "$e")"
          if [ ! -f "$DST/extensions/$b" ] || ! cmp -s "$e" "$DST/extensions/$b"; then
            $DRY_RUN_CMD cp -f "$e" "$DST/extensions/$b"
            echo "omp: synced extensions/$b"
          fi
        done
      fi
      # Our skills only — the same root also holds `luvus`, installed and
      # refreshed by `luvus skill enable`. Per-skill copy, nothing pruned.
      if [ -d "$SRC/skills" ]; then
        for s in "$SRC/skills"/*/SKILL.md; do
          [ -f "$s" ] || continue
          d="$(basename "$(dirname "$s")")"
          mkdir -p "$DST/skills/$d"
          if [ ! -f "$DST/skills/$d/SKILL.md" ] || ! cmp -s "$s" "$DST/skills/$d/SKILL.md"; then
            $DRY_RUN_CMD cp -f "$s" "$DST/skills/$d/SKILL.md"
            echo "omp: synced skills/$d/SKILL.md"
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
