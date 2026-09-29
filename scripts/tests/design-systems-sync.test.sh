#!/usr/bin/env bash
# Offline fixture tests for design-systems-sync.sh. Exits non-zero on any failure.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/design-systems-sync.sh"
FAILED=0
ok()   { echo "ok: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

new_fixture() {
  local base; base="$(mktemp -d)"
  mkdir -p "$base/upstream/design-systems/alpha" "$base/upstream/design-systems/beta"
  printf '# Alpha design\n' > "$base/upstream/design-systems/alpha/DESIGN.md"
  printf '{"id":"alpha","name":"Alpha","category":"Developer Tools"}\n' \
    > "$base/upstream/design-systems/alpha/manifest.json"
  printf ':root{--a:1}\n' > "$base/upstream/design-systems/alpha/tokens.css"
  printf '# Alpha usage\n' > "$base/upstream/design-systems/alpha/USAGE.md"
  printf '# Beta design\n' > "$base/upstream/design-systems/beta/DESIGN.md"
  printf '{"id":"beta","name":"Beta","category":"Modern & Minimal"}\n' \
    > "$base/upstream/design-systems/beta/manifest.json"
  printf ':root{--b:2}\n' > "$base/upstream/design-systems/beta/tokens.css"
  mkdir -p "$base/upstream/design-systems/beta/preview" "$base/upstream/design-systems/beta/source"
  printf 'ru\n' > "$base/upstream/design-systems/beta/DESIGN-ru.md"
  printf 'png\n' > "$base/upstream/design-systems/beta/preview/p.png"
  printf 'ev\n'  > "$base/upstream/design-systems/beta/source/evidence.md"
  local corpus="$base/corpus"
  mkdir -p "$corpus"
  jq -n '{version:1, upstream:"nexu-io/open-design", pathPrefix:"design-systems",
          sizeCapMB:12, keep:["DESIGN.md","manifest.json","tokens.css","USAGE.md"],
          banned:["DESIGN-*.md","preview/","source/","assets/","fonts/","*.png"],
          packages:["alpha","beta"]}' > "$corpus/selection.json"
  echo "$base"
}

# --- t_sync_strips ---
base="$(new_fixture)"
DS_CORPUS_DIR="$base/corpus" DS_UPSTREAM_DIR="$base/upstream" \
  bash "$SCRIPT" --sync >/dev/null || fail "sync exited non-zero"
[ -f "$base/corpus/packages/alpha/DESIGN.md" ]  || fail "alpha DESIGN.md missing"
[ -f "$base/corpus/packages/beta/tokens.css" ]  || fail "beta tokens.css missing"
[ ! -e "$base/corpus/packages/beta/DESIGN-ru.md" ] || fail "banned localized file copied"
[ ! -e "$base/corpus/packages/beta/preview" ]   || fail "banned preview dir copied"
[ -f "$base/corpus/PROVENANCE.json" ]           || fail "PROVENANCE.json missing"
jq -e '.packages.alpha.sha256' "$base/corpus/PROVENANCE.json" >/dev/null \
  && ok "t_sync_strips" || fail "provenance sha missing"
rm -rf "$base"

# --- t_add_and_list ---
base="$(new_fixture)"
mkdir -p "$base/upstream/design-systems/gamma"
printf '# Gamma\n' > "$base/upstream/design-systems/gamma/DESIGN.md"
printf '{}\n'       > "$base/upstream/design-systems/gamma/manifest.json"
printf ':root{}\n'  > "$base/upstream/design-systems/gamma/tokens.css"
DS_CORPUS_DIR="$base/corpus" DS_UPSTREAM_DIR="$base/upstream" \
  bash "$SCRIPT" --add gamma >/dev/null || fail "--add exited non-zero"
jq -e '.packages | index("gamma")' "$base/corpus/selection.json" >/dev/null \
  && ok "t_add_and_list" || fail "gamma not in selection"
rm -rf "$base"

if [ "$FAILED" -ne 0 ]; then echo "tests failed"; exit 1; fi
echo "all tests passed"
