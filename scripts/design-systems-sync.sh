#!/usr/bin/env bash
# Vendor + gate the designer reference corpus.
# Modes: --sync --add --report --check --index --list --rehash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORPUS_DIR="${DS_CORPUS_DIR:-$ROOT/config/skills/designer/references/design-systems}"
SELECTION="$CORPUS_DIR/selection.json"
PROVENANCE="$CORPUS_DIR/PROVENANCE.json"
PKG_DIR="$CORPUS_DIR/packages"
UPSTREAM_SLUG="nexu-io/open-design"
UPSTREAM_PATH="design-systems"
CLEANUP_DIR=""

usage() { echo "usage: $0 --sync|--add <id>...|--report|--check|--index|--list|--rehash" >&2; exit 2; }
die()   { echo "FAIL: $*" >&2; exit 1; }
info()  { echo "$*"; }
cleanup() { [ -n "$CLEANUP_DIR" ] && rm -rf "$CLEANUP_DIR" || true; }
trap cleanup EXIT

need() { command -v "$1" >/dev/null || die "required command missing: $1"; }
need jq

# fetch_upstream: echo path to upstream checkout (DS_UPSTREAM_DIR or fresh sparse clone)
fetch_upstream() {
  if [ -n "${DS_UPSTREAM_DIR:-}" ]; then echo "$DS_UPSTREAM_DIR"; return; fi
  need git
  CLEANUP_DIR="$(mktemp -d)"
  git clone --quiet --depth 1 --filter=blob:none --sparse \
    "https://github.com/$UPSTREAM_SLUG.git" "$CLEANUP_DIR/od"
  git -C "$CLEANUP_DIR/od" sparse-checkout set "$UPSTREAM_PATH" >/dev/null
  echo "$CLEANUP_DIR/od"
}

keep_files() { jq -r '.keep[]' "$SELECTION"; }

# strip_pkg <src_pkg_dir> <dst_pkg_dir>: copy keep files only
strip_pkg() {
  local src="$1" dst="$2" f
  rm -rf "$dst"; mkdir -p "$dst"
  while IFS= read -r f; do
    [ -f "$src/$f" ] && cp -p "$src/$f" "$dst/$f"
  done < <(keep_files)
  return 0
}

# pkg_sha256 <dir>: deterministic content hash over kept files
pkg_sha256() {
  local dir="$1"
  # pin LC_ALL=C: sort -z collation is locale-dependent, so an unpinned hash
  # differs between dev (en_US.UTF-8) and CI (C) — see the 2026-09-29 CI failure
  ( cd "$dir" && export LC_ALL=C && find . -type f -print0 | sort -z | xargs -0 sha256sum ) \
    | LC_ALL=C sha256sum | cut -d' ' -f1
}
pkg_files() { find "$1" -type f | wc -l | tr -d ' '; }
pkg_bytes() { find "$1" -type f -printf '%s\n' | awk '{s+=$1} END{print s+0}'; }

write_provenance() {
  local sha="$1" tmp; tmp="$(mktemp)"
  jq -n --arg repo "$UPSTREAM_SLUG" --arg ref "main" --arg sha "$sha" \
        --arg date "$(date +%F)" '{repo:$repo, ref:$ref, sha:$sha, imported_at:$date, packages:{}}' \
    > "$tmp"
  local id pj
  for pj in "$PKG_DIR"/*/; do
    id="$(basename "$pj")"
    jq --arg id "$id" --arg s "$(pkg_sha256 "$pj")" \
       --argjson f "$(pkg_files "$pj")" --argjson b "$(pkg_bytes "$pj")" \
       '.packages[$id] = {sha256:$s, files:$f, bytes:$b}' "$tmp" > "$tmp.2"
    mv "$tmp.2" "$tmp"
  done
  mv "$tmp" "$PROVENANCE"
}

mode_sync() {
  local up; up="$(fetch_upstream)"
  local sha; sha="$(git -C "$up" rev-parse HEAD 2>/dev/null || echo fixture)"
  mkdir -p "$PKG_DIR"
  local id src
  while IFS= read -r id; do
    src="$up/$UPSTREAM_PATH/$id"
    [ -d "$src" ] || die "upstream package missing: $id"
    strip_pkg "$src" "$PKG_DIR/$id"
  done < <(jq -r '.packages[]' "$SELECTION")
  write_provenance "$sha"
  info "synced $(jq -r '.packages|length' "$SELECTION") packages @ ${sha:0:12}"
  git -C "$ROOT" status --short -- "$CORPUS_DIR" || true
}

mode_add() {
  local up; up="$(fetch_upstream)"
  local id tmp; tmp="$(mktemp)"
  for id in "$@"; do
    [ -d "$up/$UPSTREAM_PATH/$id" ] || die "unknown upstream package: $id"
    jq --arg id "$id" 'if (.packages | index($id)) then . else .packages += [$id] end' \
      "$SELECTION" > "$tmp" && mv "$tmp" "$SELECTION"
    info "added: $id"
  done
  mode_sync
}

mode_rehash() {
  [ -f "$PROVENANCE" ] || die "provenance missing: $PROVENANCE"
  [ -d "$PKG_DIR" ] || die "packages dir missing: $PKG_DIR"
  local tmp; tmp="$(mktemp)"
  cp "$PROVENANCE" "$tmp"
  local pj id n=0
  for pj in "$PKG_DIR"/*/; do
    [ -d "$pj" ] || die "package dir missing: $pj"
    id="$(basename "$pj")"
    jq --arg id "$id" --arg s "$(pkg_sha256 "$pj")" \
       '.packages[$id].sha256 = $s' "$tmp" > "$tmp.2"
    mv "$tmp.2" "$tmp"
    n=$((n + 1))
  done
  mv "$tmp" "$PROVENANCE"
  info "rehash: $n packages updated"
}

mode_list() {
  echo "packages: $(jq -r '.packages|length' "$SELECTION")"
  [ -d "$PKG_DIR" ] && echo "on disk:  $(find "$PKG_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  [ -d "$PKG_DIR" ] && echo "bytes:    $(find "$PKG_DIR" -type f -printf '%s\n' | awk '{s+=$1} END{print s+0}')"
  jq -r '.packages[]' "$SELECTION" | sort | paste -sd' '
}

check_fail() { echo "FAIL: $*" >&2; CHECK_FAILED=1; }

mode_check() {
  [ -f "$SELECTION" ] || die "selection missing: $SELECTION"
  CHECK_FAILED=0
  local id d

  # rule 1: parity both ways
  while IFS= read -r id; do
    [ -d "$PKG_DIR/$id" ] || check_fail "parity: selection id not on disk: $id"
  done < <(jq -r '.packages[]' "$SELECTION")
  if [ -d "$PKG_DIR" ]; then
    while IFS= read -r d; do
      jq -e --arg d "$d" '.packages | index($d)' "$SELECTION" >/dev/null \
        || check_fail "parity: disk package not in selection: $d"
    done < <(find "$PKG_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n')
  fi

  # rule 2: required files
  while IFS= read -r id; do
    for f in manifest.json DESIGN.md tokens.css; do
      [ -f "$PKG_DIR/$id/$f" ] || check_fail "required: $id missing $f"
    done
  done < <(jq -r '.packages[]' "$SELECTION")

  # rule 3: banned files
  if [ -d "$PKG_DIR" ]; then
    while IFS= read -r p; do
      check_fail "banned: $p"
    done < <(cd "$PKG_DIR" && {
      find . -name 'DESIGN-*.md' ! -name 'DESIGN.md'
      find . \( -name '*.png' -o -name '*.jpg' -o -name '*.webp' -o -name '*.woff' \
             -o -name '*.woff2' -o -name '*.ttf' -o -name '*.otf' \)
      find . -type d \( -name preview -o -name source -o -name assets -o -name fonts \) -print
    } | sed 's|^\./||')
  fi

  # rule 4: size cap
  if [ -d "$PKG_DIR" ]; then
    local cap bytes
    cap="$(jq -r '.sizeCapMB' "$SELECTION")"
    bytes="$(find "$PKG_DIR" -type f -printf '%s\n' | awk '{s+=$1} END{print s+0}')"
    awk -v b="$bytes" -v c="$cap" 'BEGIN{exit !(b <= c*1048576)}' \
      || check_fail "cap: corpus ${bytes}B exceeds ${cap}MB"
  fi

  # rule 5: index freshness (regenerate to a temp copy and diff)
  if [ -d "$PKG_DIR" ] && [ -f "$CORPUS_DIR/INDEX.md" ]; then
    local t; t="$(mktemp -d)"
    render_index "$t" >/dev/null
    diff -q "$t/INDEX.md" "$CORPUS_DIR/INDEX.md" >/dev/null \
      || check_fail "index: INDEX.md stale; run --index"
    diff -q "$t/index.json" "$CORPUS_DIR/index.json" >/dev/null \
      || check_fail "index: index.json stale; run --index"
    rm -rf "$t"
  elif [ -d "$PKG_DIR" ]; then
    check_fail "index: INDEX.md missing; run --index"
  fi

  # rule 6: provenance integrity
  if [ -f "$PROVENANCE" ]; then
    while IFS= read -r id; do
      local want got
      want="$(jq -r --arg id "$id" '.packages[$id].sha256 // empty' "$PROVENANCE")"
      [ -n "$want" ] || { check_fail "provenance: no entry for $id"; continue; }
      got="$(pkg_sha256 "$PKG_DIR/$id")"
      [ "$want" = "$got" ] || check_fail "provenance: $id modified (sha mismatch)"
    done < <(jq -r '.packages[]' "$SELECTION")
  else
    [ -d "$PKG_DIR" ] && check_fail "provenance: PROVENANCE.json missing"
  fi

  [ "$CHECK_FAILED" -eq 0 ] && info "check: OK" || exit 1
}

# render_index <destdir>: write INDEX.md + index.json deterministically
render_index() {
  local dest="$1"; mkdir -p "$dest"
  local norm='def norm: if . == "Editorial / Personal / Publication" or . == "Editorial · Studio"
    then "Editorial & Print" elif . == "Social & Messaging" then "Media & Consumer" else . end;'

  jq -s "$norm"'
    map({id, name, category: (.category | norm),
         tags: ((.craft.suggested // []) | sort)}) | sort_by(.id)
  ' "$PKG_DIR"/*/manifest.json > "$dest/index.json"

  {
    echo "# Design reference library"
    echo
    echo "Vendored from OpenDesign (nexu-io/open-design). Brand packages are aesthetic inspirations, not official assets; attribution lives in each \`manifest.json\`."
    echo
    echo "Read INDEX first; select <=2 packages; read only \`DESIGN.md\`, \`tokens.css\`, \`design-tokens.json\`."
    echo
    jq -r "$norm"'
      group_by(.category) | .[]
      | "## \(.[0].category)\n\n" + (map(.id) | join(", ")) + "\n"
    ' "$dest/index.json"
  } > "$dest/INDEX.md"

  local words; words="$(wc -w < "$dest/INDEX.md")"
  [ "$words" -le 1200 ] || die "INDEX over word cap: $words"
}

mode_index() { render_index "$CORPUS_DIR"; info "index: INDEX.md + index.json written"; }

mode_report() {
  local up; up="$(fetch_upstream)"
  local sel_ids local_up_ids id up_sha local_sha
  sel_ids="$(jq -r '.packages[]' "$SELECTION" | sort)"
  local_up_ids="$(ls "$up/$UPSTREAM_PATH" 2>/dev/null | sort)"

  while IFS= read -r id; do
    if ! printf '%s\n' "$local_up_ids" | grep -qx "$id"; then
      printf '%s\tmissing-upstream\n' "$id"; continue
    fi
    local staged; staged="$(mktemp -d)"
    strip_pkg "$up/$UPSTREAM_PATH/$id" "$staged/pkg"
    up_sha="$(pkg_sha256 "$staged/pkg")"; rm -rf "$staged"
    local_sha="$(pkg_sha256 "$PKG_DIR/$id")"
    if [ "$local_sha" != "$(jq -r --arg id "$id" '.packages[$id].sha256' "$PROVENANCE")" ]; then
      printf '%s\tlocal-mods\n' "$id"
    elif [ "$local_sha" != "$up_sha" ]; then
      printf '%s\tbehind\n' "$id"
    else
      printf '%s\tsame\n' "$id"
    fi
  done <<< "$sel_ids"

  while IFS= read -r id; do
    printf '%s\n' "$sel_ids" | grep -qx "$id" || printf '%s\tnew-upstream\n' "$id"
  done <<< "$local_up_ids"
}

case "${1:-}" in
  --sync)   mode_sync ;;
  --add)    shift; [ $# -ge 1 ] || usage; mode_add "$@" ;;
  --list)   mode_list ;;
  --check)  mode_check ;;
  --index)  mode_index ;;
  --rehash) mode_rehash ;;
  --report) mode_report ;;
  *) usage ;;
esac
