#!/usr/bin/env bash
# migrate-status.sh — migrate legacy repository-local work-plans tracking into
# the external XDG state root printed by plan-root.sh. Bash entrypoint; the
# implementation is the stdlib-only Python helper next to this file.
#
# Contract: see `bash migrate-status.sh --help` and
# config/skills/work-plans/SKILL.md (migration section).
set -euo pipefail

DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
HELPER="$DIR/migrate-status.py"

if ! command -v python3 >/dev/null 2>&1; then
  echo "migrate-status: python3 is required" >&2
  exit 2
fi
if [ ! -f "$HELPER" ]; then
  echo "migrate-status: helper missing: $HELPER" >&2
  exit 2
fi

exec python3 "$HELPER" "$@"
