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

# --- t_check_rules ---
base="$(new_fixture)"
export DS_CORPUS_DIR="$base/corpus" DS_UPSTREAM_DIR="$base/upstream"
bash "$SCRIPT" --sync >/dev/null
# --index lands in Task 4; here the corpus legitimately lacks INDEX -> expect the index rule
{ bash "$SCRIPT" --check 2>&1 || true; } | grep -q "index: INDEX.md missing" \
  && ok "t_check_index_missing" || fail "index-missing not reported"

mkdir -p "$base/corpus/packages/orphan"
bash "$SCRIPT" --check >/dev/null 2>&1 && fail "orphan not caught" || true
rm -rf "$base/corpus/packages/orphan"

printf 'x\n' > "$base/corpus/packages/alpha/DESIGN-uk.md"
{ bash "$SCRIPT" --check 2>&1 || true; } | grep -q "banned" && ok "t_check_banned" || fail "banned file not caught"
rm "$base/corpus/packages/alpha/DESIGN-uk.md"

rm "$base/corpus/packages/alpha/tokens.css"
{ bash "$SCRIPT" --check 2>&1 || true; } | grep -q "required" && ok "t_check_required" || fail "missing required not caught"
DS_UPSTREAM_DIR="$base/upstream" bash "$SCRIPT" --sync >/dev/null

printf 'drift\n' >> "$base/corpus/packages/alpha/DESIGN.md"
{ bash "$SCRIPT" --check 2>&1 || true; } | grep -q "provenance" && ok "t_check_provenance" || fail "drift not caught"
bash "$SCRIPT" --sync >/dev/null

jq '.sizeCapMB = 0.0001' "$base/corpus/selection.json" > "$base/corpus/s.tmp" \
  && mv "$base/corpus/s.tmp" "$base/corpus/selection.json"
{ bash "$SCRIPT" --check 2>&1 || true; } | grep -q "cap" && ok "t_check_cap" || fail "cap not caught"
jq '.sizeCapMB = 12' "$base/corpus/selection.json" > "$base/corpus/s.tmp" \
  && mv "$base/corpus/s.tmp" "$base/corpus/selection.json"

printf 'stale\n' >> "$base/corpus/INDEX.md"
{ bash "$SCRIPT" --check 2>&1 || true; } | grep -q "index" && ok "t_check_index_stale" || fail "stale index not caught"
unset DS_CORPUS_DIR DS_UPSTREAM_DIR
rm -rf "$base"

# --- t_index_deterministic_and_green ---
base="$(new_fixture)"
export DS_CORPUS_DIR="$base/corpus" DS_UPSTREAM_DIR="$base/upstream"
bash "$SCRIPT" --sync >/dev/null
bash "$SCRIPT" --index >/dev/null || fail "--index exited non-zero"
bash "$SCRIPT" --index >/dev/null
cp "$base/corpus/INDEX.md" "$base/INDEX.1"
bash "$SCRIPT" --index >/dev/null
diff -q "$base/corpus/INDEX.md" "$base/INDEX.1" >/dev/null \
  && ok "t_index_deterministic" || fail "INDEX.md not deterministic"
words="$(wc -w < "$base/corpus/INDEX.md")"
[ "$words" -le 1200 ] && ok "t_index_wordcap ($words words)" || fail "INDEX over cap: $words"
bash "$SCRIPT" --check >/dev/null && ok "t_check_green" || fail "check green run failed"
unset DS_CORPUS_DIR DS_UPSTREAM_DIR
rm -rf "$base"

if [ "$FAILED" -ne 0 ]; then echo "tests failed"; exit 1; fi
echo "all tests passed"
