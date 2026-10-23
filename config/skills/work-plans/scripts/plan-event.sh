#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'plan-event: %s\n' "$*" >&2; exit 2; }
[ "$#" -eq 4 ] || fail 'usage: plan-event.sh <plan> <state> <message> <root-relative artifact>'
PLAN="$1" STATE="$2" MESSAGE="$3" ARTIFACT="$4"
[[ -n "$PLAN" && "$PLAN" != *[!a-z0-9-]* ]] || fail 'invalid plan name'
case "$STATE" in PLAN|WAIT|WORKING|DONE|FAILED) ;; *) fail 'invalid state' ;; esac
[[ -n "$MESSAGE" && "$MESSAGE" != *$'\n'* && "$MESSAGE" != *$'\r'* && "$MESSAGE" != *'|'* ]] || fail 'message must be one nonempty line without |'
[[ "$ARTIFACT" != /* && "$ARTIFACT" != *$'\n'* && "$ARTIFACT" != *$'\r'* && "$ARTIFACT" != *'|'* ]] || fail 'artifact must be a safe root-relative path'
command -v flock >/dev/null || fail 'flock is required for shared timeline writes'
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAN_ROOT="$(bash "$SCRIPT_DIR/plan-root.sh")" || exit 2
[ -d "$PLAN_ROOT" ] || fail 'tracking root does not exist'
case "$ARTIFACT" in
  "$PLAN/"*.md) OWNER="$PLAN_ROOT/$PLAN" ;;
  archive/????-??-??-"$PLAN/"*.md) ARCHIVE_ENTRY="${ARTIFACT#archive/}"; OWNER="$PLAN_ROOT/archive/${ARCHIVE_ENTRY%%/*}" ;;
  *) fail 'artifact must belong to the named plan' ;;
esac
[ -d "$OWNER" ] && [ ! -L "$OWNER" ] || fail 'plan directory must exist and not be a symlink'
TARGET="$(realpath -e -- "$PLAN_ROOT/$ARTIFACT")" || fail 'artifact does not exist'
CANONICAL_OWNER="$(realpath -e -- "$OWNER")" || fail 'cannot resolve plan directory'
[[ "$TARGET" == "$CANONICAL_OWNER/"* && -f "$TARGET" ]] || fail 'artifact escapes its plan or is not a file'
[[ "$CANONICAL_OWNER" == "$PLAN_ROOT/"* ]] || fail 'plan directory escapes tracking root'
[ ! -L "$PLAN_ROOT/TIMELINE.md" ] || fail 'TIMELINE.md must not be a symlink'
[[ ! -e "$PLAN_ROOT/TIMELINE.md" || -f "$PLAN_ROOT/TIMELINE.md" ]] || fail 'TIMELINE.md must be a regular file'
LOCK_DIR="$(dirname "$PLAN_ROOT")/.locks"
LOCK="$LOCK_DIR/$(basename "$PLAN_ROOT").timeline.lock"
[ ! -L "$LOCK_DIR" ] && [ ! -L "$LOCK" ] || fail 'timeline lock path must not be a symlink'
[[ ! -e "$LOCK" || -f "$LOCK" ]] || fail 'timeline lock must be a regular file'
mkdir -p -- "$LOCK_DIR"
exec 9>"$LOCK"
flock -x 9
# Never rewrite a shared timeline snapshot: other plans may append concurrently.
printf '%s | %s | %s | %s | %s\n' "$(date -u +%F)" "$PLAN" "$STATE" "$MESSAGE" "$ARTIFACT" >> "$PLAN_ROOT/TIMELINE.md"
