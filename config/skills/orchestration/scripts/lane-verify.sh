#!/usr/bin/env bash
# lane-verify.sh — snapshot / check / rollback for atomic crumb sub-waves in a
# lane worktree (feature: "crumbs in lanes").
#
#   lane-verify.sh snapshot <worktree> <snapdir> <manifest>
#   lane-verify.sh check    <worktree> <snapdir> <manifest> [lane]
#   lane-verify.sh rollback <worktree> <snapdir> <manifest> [lane]
#
# Manifest: TSV beside the worktree, one crumb per line, TAB-separated:
#   lane<TAB>crumb<TAB>files(space-separated)<TAB>resources(space|"-")<TAB>gate
# The gate runs FROM the worktree root. `resources` is INFORMATIONAL only here
# (recorded, never acted on); resource disjointness is plan-check's job.
#
# The manifest is RE-RENDERED PER READY SET: the orchestrator writes the same
# path each time, containing only the crumbs of that set. snapshot, check and
# rollback therefore each operate on the CURRENT set's rows.
#
# check re-runs every selected crumb's gate, scope-checks git status against the
# declared files (the declared union is EVERY manifest row; the optional [lane]
# argument filters GATES only), prints a table + violations + verdict, and
# appends `verified rc=` markers to `<worktree>/../<prefix>-<crumb>-return.md`
# when that return file already exists.
# Exit: 0 GREEN / 1 RED / 2 usage-or-manifest error.
set -uo pipefail

usage() {
  cat >&2 <<'EOF'
usage: lane-verify.sh snapshot <worktree> <snapdir> <manifest>
       lane-verify.sh check    <worktree> <snapdir> <manifest> [lane]
       lane-verify.sh rollback <worktree> <snapdir> <manifest> [lane]

The manifest is re-rendered per ready set (same path, only that set's crumbs);
the optional [lane] filters which GATES run, not the declared-files union.
`resources` is informational only. check appends `verified rc=` markers to
<worktree>/../<prefix>-<crumb>-return.md when that file already exists.
EOF
}

die() { echo "lane-verify: $*" >&2; exit 2; }

# reject a manifest `files` token that could escape the worktree
check_rel() {
  case "$1" in
    /*|..|../*|*/../*|*/..) die "path escapes worktree: $1" ;;
  esac
}

# validate_manifest <manifest>: die 2 on any malformed row. Every non-empty,
# non-'#' line must have exactly 5 TAB-separated fields:
#   lane crumb files resources gate
# lane/crumb/gate must be non-empty; files/resources may be "-" but not empty.
# CRLF is normalized (a trailing \r is stripped); EVERY `files` token is
# escape-checked here, so all three subcommands refuse a bad manifest before
# touching anything (a refused snapshot leaves prior snapshot state untouched).
validate_manifest() {
  local manifest=$1
  local n=0 raw lane crumb files resources gate rest rel
  while IFS= read -r raw || [ -n "$raw" ]; do
    n=$((n + 1))
    raw=${raw%$'\r'}
    [ -z "$raw" ] && continue
    case "$raw" in '#'*) continue ;; esac
    IFS=$'\t' read -r lane crumb files resources gate rest <<< "$raw"
    [ -z "${rest:-}" ] || die "manifest line $n: expected 5 TAB-separated fields"
    [ -n "${lane:-}" ] || die "manifest line $n: empty lane"
    [ -n "${crumb:-}" ] || die "manifest line $n: empty crumb"
    [ -n "${files:-}" ] || die "manifest line $n: empty files (use '-' for none)"
    [ -n "${resources:-}" ] || die "manifest line $n: empty resources (use '-' for none)"
    [ -n "${gate:-}" ] || die "manifest line $n: empty gate"
    for rel in $files; do
      [ -n "$rel" ] || continue
      [ "$rel" = "-" ] && continue
      check_rel "$rel"
    done
  done < "$manifest"
}

# ── snapshot: clear snapdir, stamp, record pre-run state of every declared path
cmd_snapshot() {
  local worktree=$1 snapdir=$2 manifest=$3

  # containment: never let snapdir clean-up reach the worktree or an ancestor
  local wtr snr
  wtr=$(realpath -m -- "$worktree") || die "cannot resolve worktree: $worktree"
  snr=$(realpath -m -- "$snapdir") || die "cannot resolve snapdir: $snapdir"
  [ "$snr" = "$wtr" ] && die "snapdir must not be the worktree: $snapdir"
  case "$snr" in "$wtr"/*) die "snapdir must not be inside the worktree: $snapdir" ;; esac
  case "$wtr" in "$snr"/*) die "snapdir must not be an ancestor of the worktree: $snapdir" ;; esac

  # refuse to rm -rf a pre-existing non-empty dir we did not create
  if [ -d "$snapdir" ] && [ -n "$(ls -A -- "$snapdir" 2>/dev/null)" ] \
     && [ ! -f "$snapdir/.lane-verify" ]; then
    die "refusing to remove non-empty snapdir without .lane-verify marker: $snapdir"
  fi

  rm -rf -- "$snapdir" || die "cannot clear snapdir: $snapdir"
  mkdir -p -- "$snapdir/tree" || die "cannot create snapdir: $snapdir"
  : > "$snapdir/.lane-verify" || die "cannot write snapdir marker"
  date +%s%3N > "$snapdir/stamp" || die "cannot write stamp"
  : > "$snapdir/files.lst"

  declare -A seen=()
  local lane crumb files resources gate rel src dst
  while IFS=$'\t' read -r lane crumb files resources gate; do
    [ -z "${lane:-}" ] && continue
    case "$lane" in '#'*) continue ;; esac
    gate=${gate%$'\r'}
    for rel in $files; do
      [ -n "$rel" ] || continue
      [ "$rel" = "-" ] && continue
      check_rel "$rel"
      [ -n "${seen[$rel]:-}" ] && continue
      seen[$rel]=1
      src="$worktree/$rel"
      if [ -e "$src" ] || [ -L "$src" ]; then
        dst="$snapdir/tree/$rel"
        mkdir -p -- "$(dirname -- "$dst")" || die "cannot mkdir $(dirname -- "$dst")"
        if [ -d "$src" ] && [ ! -L "$src" ]; then
          cp -pR -- "$src" "$dst" || die "cannot snapshot $rel"
        else
          cp -p -- "$src" "$dst" || die "cannot snapshot $rel"
        fi
        printf 'present %s\n' "$rel" >> "$snapdir/files.lst"
      else
        printf 'absent %s\n' "$rel" >> "$snapdir/files.lst"
      fi
    done
  done < "$manifest"

  echo "snapshot: $(wc -l < "$snapdir/files.lst") declared paths -> $snapdir (stamp $(cat "$snapdir/stamp"))"
}

# ── check: re-run gates, scope-check git status, verdict, append markers
cmd_check() {
  local worktree=$1 snapdir=$2 manifest=$3 lane_filter=${4:-}

  [ -d "$snapdir" ] || die "snapdir not found: $snapdir (run snapshot first)"
  [ -f "$snapdir/files.lst" ] || die "snapdir missing files.lst: $snapdir"

  # scope-check needs real git status; a non-git worktree must not silently pass
  git -C "$worktree" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "not a git worktree: $worktree"

  local dir prefix ts
  dir=$(dirname -- "$worktree")
  prefix=$(basename -- "${worktree%/}")
  ts=$(date +%s%3N)

  local fail=0 rows=0
  declare -A declared=()

  printf '%-14s | %-16s | %-44s | %s\n' lane crumb gate rc
  printf -- '---------------+------------------+----------------------------------------------+---\n'

  local lane crumb files resources gate rc rel
  while IFS=$'\t' read -r lane crumb files resources gate; do
    [ -z "${lane:-}" ] && continue
    case "$lane" in '#'*) continue ;; esac
    gate=${gate%$'\r'}

    # declared union = ALL manifest rows; the [lane] filter applies to gates only
    for rel in $files; do
      [ -n "$rel" ] || continue
      [ "$rel" = "-" ] && continue
      check_rel "$rel"
      declared[$rel]=1
    done

    [ -n "$lane_filter" ] && [ "$lane" != "$lane_filter" ] && continue

    ( cd -- "$worktree" && eval "$gate" ) >/dev/null 2>&1
    rc=$?
    [ "$rc" -eq 0 ] || rc=1
    [ "$rc" -eq 0 ] || fail=1
    rows=$((rows + 1))
    printf '%-14s | %-16s | %-44s | %s\n' "$lane" "$crumb" "$gate" "$rc"

    local rf="$dir/$prefix-$crumb-return.md"
    if [ -f "$rf" ]; then
      printf 'verified rc=%s @%s\n' "$rc" "$ts" >> "$rf"
    fi
  done < "$manifest"

  [ "$rows" -gt 0 ] || echo "note: no crumbs selected (lane='${lane_filter:-all}')"

  # scope: every changed worktree path must be declared by ANY manifest row
  # (the `[lane]` filter applies to gates only, not the declared union).
  # -uall so an untracked dir is not collapsed to `?? dir/`.
  declare -A unclaimed=()
  local line entry p
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    entry=${line:3}
    local paths=()
    case "$entry" in
      *" -> "*) paths=( "${entry%% -> *}" "${entry#* -> }" ) ;;
      *)        paths=( "$entry" ) ;;
    esac
    for p in "${paths[@]}"; do
      p=${p#\"}; p=${p%\"}                 # strip surrounding quotes
      [ -n "$p" ] || continue
      [ -n "${declared[$p]:-}" ] && continue
      unclaimed[$p]=1
    done
  done < <(git -C "$worktree" status --porcelain -uall 2>/dev/null)

  echo
  if [ "${#unclaimed[@]}" -gt 0 ]; then
    echo "scope violations (changed but undeclared):"
    local u
    while IFS= read -r u; do
      echo "  UNCLAIMED $u"
    done < <(printf '%s\n' "${!unclaimed[@]}" | sort)
    fail=1
  else
    echo "scope violations: none"
  fi

  local verdict=GREEN
  [ "$fail" -eq 0 ] || verdict=RED
  echo "verdict: $verdict"
  [ "$verdict" = GREEN ]
}

# ── rollback: restore snapshot state for every declared path of selected lanes
cmd_rollback() {
  local worktree=$1 snapdir=$2 manifest=$3 lane_filter=${4:-}

  [ -d "$snapdir" ] || die "snapdir not found: $snapdir (run snapshot first)"
  [ -f "$snapdir/files.lst" ] || die "snapdir missing files.lst: $snapdir"
  [ -d "$snapdir/tree" ] || die "snapdir missing tree/: $snapdir"

  declare -A state=()
  local line s p
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    case "$line" in *" "*) ;; *) continue ;; esac
    s=${line%% *}
    p=${line#* }
    state[$p]=$s
  done < "$snapdir/files.lst"

  declare -A done=()
  local lane crumb files resources gate rel
  while IFS=$'\t' read -r lane crumb files resources gate; do
    [ -z "${lane:-}" ] && continue
    case "$lane" in '#'*) continue ;; esac
    gate=${gate%$'\r'}
    [ -n "$lane_filter" ] && [ "$lane" != "$lane_filter" ] && continue
    for rel in $files; do
      [ -n "$rel" ] || continue
      [ "$rel" = "-" ] && continue
      check_rel "$rel"
      [ -n "${done[$rel]:-}" ] && continue
      done[$rel]=1
      case "${state[$rel]:-}" in
        present)
          mkdir -p -- "$(dirname -- "$worktree/$rel")" || die "cannot mkdir for $rel"
          if [ -d "$snapdir/tree/$rel" ] && [ ! -L "$snapdir/tree/$rel" ]; then
            rm -rf -- "$worktree/$rel"
            cp -pR -- "$snapdir/tree/$rel" "$worktree/$rel" || die "cannot restore $rel"
          else
            cp -p -- "$snapdir/tree/$rel" "$worktree/$rel" || die "cannot restore $rel"
          fi
          echo "restored $rel"
          ;;
        absent)
          rm -rf -- "$worktree/$rel" || die "cannot delete $rel"
          echo "deleted  $rel (absent at snapshot)"
          ;;
        *)
          echo "skip     $rel (not in snapshot)"
          ;;
      esac
    done
  done < "$manifest"
}

main() {
  local cmd=${1:-}
  case "$cmd" in
    snapshot)
      [ $# -eq 4 ] || { usage; die "snapshot needs <worktree> <snapdir> <manifest>"; } ;;
    check|rollback)
      { [ $# -eq 4 ] || [ $# -eq 5 ]; } || { usage; die "$cmd needs <worktree> <snapdir> <manifest> [lane]"; } ;;
    ""|-h|--help)
      usage; exit 2 ;;
    *)
      die "unknown command: $cmd (snapshot|check|rollback)" ;;
  esac

  local worktree=$2 snapdir=$3 manifest=$4 lane=${5:-}
  [ -d "$worktree" ] || die "worktree not a directory: $worktree"
  case "$snapdir" in ""|/) die "invalid snapdir: '$snapdir'" ;; esac
  [ -f "$manifest" ] || die "manifest not found: $manifest"

  validate_manifest "$manifest"

  case "$cmd" in
    snapshot) cmd_snapshot "$worktree" "$snapdir" "$manifest" ;;
    check)    cmd_check "$worktree" "$snapdir" "$manifest" "$lane" ;;
    rollback) cmd_rollback "$worktree" "$snapdir" "$manifest" "$lane" ;;
  esac
}

main "$@"
