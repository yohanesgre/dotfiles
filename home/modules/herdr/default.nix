{
  config,
  lib,
  pkgs,
  ...
}:
{
  # herdr (https://herdr.dev) is the agent multiplexer again (2026-11-05),
  # replacing luvus (which replaced herdr on 2026-09-23). The binary comes from
  # the upstream installer (home/modules/upstream); this module owns the wiring
  # that has to run after the binary exists:
  #   - integrations: per-agent session identity/resume and lifecycle state.
  #     `herdr integration install omp` writes ~/.omp/agent/extensions/
  #     herdr-omp-agent-state.ts; `... install opencode` writes the server plugin
  #     (~/.config/opencode/plugins/herdr-agent-state.js), the shared TUI plugin
  #     (herdr-tui-session.js), the V2 TUI entrypoint (herdr-opencode/tui.js) and
  #     registers `./herdr-opencode` in ~/.config/opencode/cli.json (V1 goes in
  #     tui.jsonc). Herdr owns those files; the dotfiles cli.json copy carries
  #     the same registration so the copy activation cannot drop it.
  #   - bundled skill: herdr ships a release-matched Agent Skill; `herdr --skill`
  #     prints it without a running server. Installed into the same three roots
  #     luvus used (~/.agents/skills, ~/.config/opencode/skills,
  #     ~/.omp/agent/skills); upstream owns the content, so nothing is committed.
  #   - cleanup: luvus served this role until 2026-11-05. Remove its binary,
  #     OpenCode TUI plugin, skill copies and OMP extension, plus its state dir
  #     and systemd units. The luvus server is daemonised by a oneshot unit with
  #     KillMode=process, so removing the unit does not reap it — stop it first.
  home.activation.herdrWiring =
    lib.hm.dag.entryAfter [ "writeBoundary" "systemd" "upstreamInstall" ]
      ''
        export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
        warn() { echo "herdr: $*" >&2; }

        # luvus cleanup (one-time; every guard keeps later switches no-ops).
        systemctl --user stop luvus-web luvus-tunnel luvus-server >/dev/null 2>&1 || true
        if [ -x "$HOME/.local/bin/luvus" ]; then
          "$HOME/.local/bin/luvus" server stop >/dev/null 2>&1 || true
        fi
        if [ -e "$HOME/.local/bin/luvus" ]; then
          $DRY_RUN_CMD rm -f "$HOME/.local/bin/luvus"
          echo "herdr: removed luvus binary"
        fi
        for d in \
          "$HOME/.luvus" \
          "$HOME/.config/luvus" \
          "$HOME/.config/opencode/luvus-v2" \
          "$HOME/.config/opencode/skills/luvus" \
          "$HOME/.omp/agent/skills/luvus" \
          "$HOME/.agents/skills/luvus" \
          "$HOME/.claude/skills/luvus" \
          "$HOME/.letta/skills/luvus" \
          "$HOME/apps/hermes/skills/luvus"
        do
          if [ -e "$d" ] || [ -L "$d" ]; then
            $DRY_RUN_CMD rm -rf "$d"
            echo "herdr: removed $d"
          fi
        done
        if [ -e "$HOME/.omp/agent/extensions/luvus.ts" ]; then
          $DRY_RUN_CMD rm -f "$HOME/.omp/agent/extensions/luvus.ts"
          echo "herdr: removed luvus omp extension"
        fi

        if [ -x "$HOME/.local/bin/herdr" ]; then
          for host in omp opencode; do
            if "$HOME/.local/bin/herdr" integration install "$host" >/dev/null 2>&1; then
              echo "herdr: $host integration installed"
            else
              warn "$host integration install failed (continuing)"
            fi
          done

          SKILL_TMP="$HOME/.herdr-skill.$$"
          if "$HOME/.local/bin/herdr" --skill > "$SKILL_TMP" 2>/dev/null; then
            for dir in \
              "$HOME/.agents/skills/herdr" \
              "$HOME/.config/opencode/skills/herdr" \
              "$HOME/.omp/agent/skills/herdr"
            do
              mkdir -p "$dir"
              if ! cmp -s "$SKILL_TMP" "$dir/SKILL.md"; then
                $DRY_RUN_CMD cp -f "$SKILL_TMP" "$dir/SKILL.md"
                echo "herdr: synced $dir/SKILL.md"
              fi
            done
          else
            warn "herdr --skill failed (continuing)"
          fi
          rm -f "$SKILL_TMP"
        else
          warn "herdr binary missing — skipping integrations/skill"
        fi
      '';
}
