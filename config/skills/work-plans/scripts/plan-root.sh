#!/usr/bin/env bash
# Print the external work-plans tracking root for the current Git repository.
# Read-only: prints the path, creates nothing. Works from any linked worktree.
# The root must be physically outside every checkout of the repository, so an
# absolute path inside the repo or a symlink aliasing it is rejected.
set -euo pipefail

die() { printf 'plan-root: %s\n' "$*" >&2; exit 1; }

inside=$(git rev-parse --is-inside-work-tree 2>/dev/null) \
  || die "not inside a Git work tree; run from the project repo or a linked worktree"
[ "$inside" = "true" ] \
  || die "not inside a Git work tree; run from the project repo or a linked worktree"

common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
  || die "cannot determine the Git common directory"
[ -n "$common_dir" ] || die "empty Git common directory"
canonical=$(realpath -e -- "$common_dir" 2>/dev/null) \
  || die "cannot resolve the Git common directory: $common_dir"

# Readable name comes from the common-dir parent, so every linked worktree of
# the same repository yields the same name.
readable=$(basename -- "$(dirname -- "$canonical")")
name=$(printf '%s' "$readable" | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//')
[ -n "$name" ] || name=repo
hash=$(printf '%s' "$canonical" | sha256sum | awk '{print $1}')
[ -n "$hash" ] || die "cannot hash the Git common directory"

# --- physical external-storage boundary -------------------------------------
# Everything below compares physical paths: existing symlink components in a
# candidate are resolved, and ancestors are included, so aliases of a checkout
# cannot pass the boundary. The common dir is physical already; worktree paths
# and the git dir are resolved the same way.
physical() { realpath -m -- "$1" 2>/dev/null; }

checkouts=()
add_checkout() {
  local path=$1 resolved
  [ -n "$path" ] || return 0
  resolved=$(physical "$path") || return 0
  [ -n "$resolved" ] || return 0
  checkouts+=("$resolved")
}

toplevel=$(git rev-parse --path-format=absolute --show-toplevel 2>/dev/null) \
  || die "cannot determine the current worktree top level"
add_checkout "$toplevel"
add_checkout "$canonical"
git_dir=$(git rev-parse --path-format=absolute --git-dir 2>/dev/null) || git_dir=""
add_checkout "$git_dir"
while IFS= read -r -d '' field; do
  case "$field" in
    'worktree '*) add_checkout "${field#worktree }" ;;
  esac
done < <(git worktree list --porcelain -z 2>/dev/null || true)

# is_inside <physical-candidate> <physical-root>: candidate equals root or is below it.
is_inside() {
  local candidate=$1 root=${2%/}
  [ -n "$root" ] || root=/
  if [ "$root" = "/" ]; then return 0; fi
  if [ "$candidate" = "$root" ]; then return 0; fi
  case "$candidate/" in
    "$root"/*) return 0 ;;
  esac
  return 1
}

require_external() {
  local candidate=$1 label=$2 root
  RESOLVED=$(physical "$candidate") \
    || die "cannot resolve the $label: $candidate"
  [ -n "$RESOLVED" ] || die "cannot resolve the $label: $candidate"
  for root in "${checkouts[@]}"; do
    if is_inside "$RESOLVED" "$root"; then
      die "$label is physically inside the Git checkout $root: $RESOLVED"
    fi
  done
}

xdg=${XDG_STATE_HOME-}
if [ -n "$xdg" ]; then
  case "$xdg" in
    /*) ;;
    *) die "XDG_STATE_HOME must be an absolute path, got: $xdg" ;;
  esac
else
  home=${HOME-}
  [ -n "$home" ] || die "neither XDG_STATE_HOME nor HOME is set"
  case "$home" in
    /*) ;;
    *) die "HOME must be an absolute path, got: $home" ;;
  esac
  xdg="$home/.local/state"
fi
while [ "$xdg" != "/" ] && [ "${xdg%/}" != "$xdg" ]; do xdg=${xdg%/}; done
[ "$xdg" = "/" ] && xdg=""

# Both the external state root and the tracking root derived from it must be
# physically outside every checkout; a legitimately external XDG symlink is
# accepted because its resolved path is external. The printed root is the
# canonical path so consumers (owner/lock checks) never see a logical alias.
require_external "${xdg:-/}" "external state root"
state_root=$RESOLVED
candidate="${state_root%/}/work-plans/${name}-${hash}"
require_external "$candidate" "work-plans tracking root"
[ ! -L "${state_root%/}/work-plans" ] || die "work-plans namespace must not be a symlink"
[ ! -L "$candidate" ] || die "repository tracking root must not be a symlink"
root_path=$RESOLVED

printf '%s\n' "$root_path"
