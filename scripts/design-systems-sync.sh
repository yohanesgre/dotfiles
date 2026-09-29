#!/usr/bin/env bash
# Vendor + gate the designer reference corpus.
# Modes: --sync --add --report --check --index --list
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORPUS_DIR="${DS_CORPUS_DIR:-$ROOT/config/skills/designer/references/design-systems}"
SELECTION="$CORPUS_DIR/selection.json"
PROVENANCE="$CORPUS_DIR/PROVENANCE.json"
PKG_DIR="$CORPUS_DIR/packages"
UPSTREAM_SLUG="nexu-io/open-design"
UPSTREAM_PATH="design-systems"
CLEANUP_DIR=""

usage() { echo "usage: $0 --sync|--add <id>...|--report|--check|--index|--list" >&2; exit 2; }
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
  ( cd "$dir" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) \
    | sha256sum | cut -d' ' -f1
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

mode_list() {
  echo "packages: $(jq -r '.packages|length' "$SELECTION")"
  [ -d "$PKG_DIR" ] && echo "on disk:  $(find "$PKG_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  [ -d "$PKG_DIR" ] && echo "bytes:    $(find "$PKG_DIR" -type f -printf '%s\n' | awk '{s+=$1} END{print s+0}')"
  jq -r '.packages[]' "$SELECTION" | sort | paste -sd' '
}

case "${1:-}" in
  --sync)   mode_sync ;;
  --add)    shift; [ $# -ge 1 ] || usage; mode_add "$@" ;;
  --list)   mode_list ;;
  --check|--index|--report) die "not implemented yet: $1" ;;
  *) usage ;;
esac
