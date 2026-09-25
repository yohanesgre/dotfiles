#!/bin/sh
# Stop the opencode.depth watcher (SIGTERM so it releases its leases).
# Only signals a pid whose cmdline names the watcher; a stale pidfile is removed.
set -u
sd="${LUVUS_MODULE_STATE_DIR:-$HOME/.luvus/modules/state/opencode.depth}"
pidfile="$sd/opencode-depth.pid"

pid_is_watcher() {
  pid="$1"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  if [ -r "/proc/$pid/cmdline" ]; then
    tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q 'watcher\.ts' && return 0
    return 1
  fi
  ps -o args= -p "$pid" 2>/dev/null | grep -q 'watcher\.ts'
}

if [ ! -f "$pidfile" ]; then
  echo "opencode.depth: no pidfile at $pidfile"
  exit 0
fi
pid="$(cat "$pidfile" 2>/dev/null || true)"
if pid_is_watcher "$pid"; then
  kill "$pid" 2>/dev/null || true
  echo "opencode.depth: sent SIGTERM to $pid"
else
  echo "opencode.depth: pidfile is stale or not a watcher; removing"
  rm -f "$pidfile"
fi
