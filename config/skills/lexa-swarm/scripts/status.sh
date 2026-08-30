#!/usr/bin/env bash
set -euo pipefail
STATUS_DIR="${STATUS_DIR:?set STATUS_DIR (e.g. <repo>/status)}"
cmd="${1:-help}"
case "$cmd" in
  report)
    lane="${2:?usage: status.sh report <lane> <state> [message]}"
    state="${3:?usage: status.sh report <lane> <state> [message]}"
    msg="${4:-}"
    mkdir -p "$STATUS_DIR"
    {
      echo "state: $state"
      echo "ts: $(date +%s)"
      echo "msg: $msg"
    } > "$STATUS_DIR/$lane.md"
    ;;
  stale)
    minutes="${2:?usage: status.sh stale <minutes>}"
    cutoff=$(( $(date +%s) - minutes * 60 ))
    for f in "$STATUS_DIR"/*.md; do
      [ -f "$f" ] || continue
      ts=$(awk '/^ts:/ {print $2}' "$f")
      if [ -n "$ts" ] && [ "$ts" -lt "$cutoff" ]; then
        echo "$f"
      fi
    done
    ;;
  show)
    lane="${2:?usage: status.sh show <lane>}"
    cat "$STATUS_DIR/$lane.md" 2>/dev/null || { echo "no status for $lane"; exit 1; }
    ;;
  *)
    echo "usage: status.sh report <lane> <state> [msg] | stale <minutes> | show <lane>" >&2
    exit 2
    ;;
esac
