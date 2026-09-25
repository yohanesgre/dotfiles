#!/bin/sh
# Pane lifecycle hook: make sure the watcher is running after a pane change.
# The watcher already repaints on its own poll, so this only revives it.
set -u
sd="${LUVUS_MODULE_STATE_DIR:-$HOME/.luvus/modules/state/opencode.depth}"
pidfile="$sd/opencode-depth.pid"

if [ -f "$pidfile" ]; then
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    if [ -r "/proc/$pid/cmdline" ]; then
      tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q 'watcher\.ts' && exit 0
    elif ps -o args= -p "$pid" 2>/dev/null | grep -q 'watcher\.ts'; then
      exit 0
    fi
    echo "opencode.depth: stale pidfile (pid $pid is not the watcher); reclaiming"
    rm -f "$pidfile"
  fi
fi
exec bun run src/startup.ts
