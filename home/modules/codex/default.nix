{ lib, ... }:
{
  home.activation.codexMcpServers = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    set -u
    CODEX_BIN="$HOME/.local/bin/codex"
    [ -x "$CODEX_BIN" ] || CODEX_BIN="$(command -v codex 2>/dev/null || true)"
    if [ -z "$CODEX_BIN" ] || [ ! -x "$CODEX_BIN" ]; then
      echo "codex: binary missing; skipping MCP registration" >&2
      exit 0
    fi

    ensure_mcp() {
      name="$1"
      shift
      if "$CODEX_BIN" mcp get "$name" >/dev/null 2>&1; then
        return 0
      fi
      "$CODEX_BIN" mcp add "$name" "$@" || echo "codex: could not register MCP server $name" >&2
    }

    # browser-use removed 2026-10-11 (user request) — drop the stale registration
    # so codex stops launching the retired MCP server.
    if "$CODEX_BIN" mcp get browser-use >/dev/null 2>&1; then
      "$CODEX_BIN" mcp remove browser-use >/dev/null 2>&1 || true
    fi
    ensure_mcp codegraph --env CODEGRAPH_TELEMETRY=0 --env CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS=1800000 -- "$HOME/.bun/bin/codegraph" serve --mcp
    # jev-mcp: the key lives in ~/.config/typesafe/key, but @jkudish/jev-mcp reads
    # only TYPESAFE_API_KEY from the environment, so the command is the
    # `jev-mcp-keyfile` wrapper (home/modules/opencode). Migrate a stale direct
    # ~/.bun/bin/jev-mcp entry once, then ensure_mcp is idempotent.
    if "$CODEX_BIN" mcp get jev-mcp 2>/dev/null | grep -q 'bin/jev-mcp$'; then
      "$CODEX_BIN" mcp remove jev-mcp >/dev/null 2>&1 || true
    fi
    ensure_mcp jev-mcp -- "$HOME/.nix-profile/bin/jev-mcp-keyfile"
  '';
}
