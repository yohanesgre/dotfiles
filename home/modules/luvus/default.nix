{
  config,
  lib,
  pkgs,
  ...
}:
{
  # luvus (https://luvus.dev) replaced herdr as the agent multiplexer on 2026-09-23.
  # The binary comes from the upstream installer (home/modules/upstream); this module
  # owns the wiring that has to run after the binary exists:
  #   - integrations: per-agent session-resume hooks (omp extension, opencode TUI
  #     plugin) — the herdr-managed omp extension was removed with herdr itself
  #   - bundled skill: luvus ships a release-matched Agent Skill; `luvus skill enable`
  #     installs it into every detected agent host (~/.agents/skills/luvus,
  #     ~/.config/opencode/skills/luvus, ~/.omp/agent/skills/luvus, ...). Upstream owns
  #     that content, so it is deliberately NOT committed to config/skills.
  #   - cleanup: herdr leftovers (binary, ~/.config/herdr, omp extension, skill link)
  #   - pane shell: config.json ships `"shell": "default"`, and the luvus server
  #     process may have no SHELL in its environment (it is daemonized), in which
  #     case "default" resolves to /bin/sh — panes then open as `sh-5.3$` instead
  #     of the user's zsh. Pin the absolute path in the file (LUVUS_SHELL also
  #     overrides it). Merged with jq so every other key — including ones the
  #     in-app Settings screen wrote — is preserved; never rewrite the file whole.
  home.activation.luvusShell = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    CFG="$HOME/.luvus/config.json"
    JQ="${pkgs.jq}/bin/jq"
    if [ -f "$CFG" ] && [ -x "$JQ" ]; then
      if [ "$("$JQ" -r '.shell // ""' "$CFG" 2>/dev/null)" != "/usr/bin/zsh" ]; then
        TMP="$CFG.tmp.$$"
        if "$JQ" '.shell = "/usr/bin/zsh"' "$CFG" > "$TMP" 2>/dev/null; then
          $DRY_RUN_CMD chmod 644 "$TMP"
          $DRY_RUN_CMD mv -f "$TMP" "$CFG"
          echo "luvus: pinned pane shell to /usr/bin/zsh (restart the luvus server to apply)"
        else
          rm -f "$TMP"
        fi
      fi
    fi
  '';

  home.activation.luvusWiring = lib.hm.dag.entryAfter [ "writeBoundary" "upstreamInstall" ] ''
    export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
    warn() { echo "luvus: $*" >&2; }

    # herdr is gone (2026-09-23) — drop its runtime artifacts once
    if [ -e "$HOME/.local/bin/herdr" ]; then
      $DRY_RUN_CMD rm -f "$HOME/.local/bin/herdr"
      echo "luvus: removed herdr binary"
    fi
    if [ -d "$HOME/.config/herdr" ]; then
      $DRY_RUN_CMD rm -rf "$HOME/.config/herdr"
      echo "luvus: removed ~/.config/herdr"
    fi
    if [ -e "$HOME/.omp/agent/extensions/herdr-omp-agent-state.ts" ]; then
      $DRY_RUN_CMD rm -f "$HOME/.omp/agent/extensions/herdr-omp-agent-state.ts"
      echo "luvus: removed herdr omp extension"
    fi
    if [ -L "$HOME/.agents/skills/herdr" ]; then
      $DRY_RUN_CMD rm -f "$HOME/.agents/skills/herdr"
      echo "luvus: removed stale herdr skill link"
    fi

    if [ -x "$HOME/.local/bin/luvus" ]; then
      for host in omp opencode; do
        if "$HOME/.local/bin/luvus" integration install "$host" >/dev/null 2>&1; then
          echo "luvus: $host integration installed"
        else
          warn "$host integration install failed (continuing)"
        fi
      done
      if "$HOME/.local/bin/luvus" skill enable >/dev/null 2>&1; then
        echo "luvus: bundled skill enabled"
      else
        warn "skill enable failed (continuing)"
      fi
    else
      warn "luvus binary missing — skipping integrations/skill"
    fi
  '';
}
