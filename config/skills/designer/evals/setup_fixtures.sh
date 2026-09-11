#!/usr/bin/env bash
# Recreate the designer evaluation fixture (skill-creator eval suite).
#
# Validates the fixture against a real recorded run. The first recorded run
# (119KB single self-contained artifact) satisfies every assertion in evals.json;
# if the fixture or assertion set stops matching it, tweak here or there.
#
# Layout produced:
#   <root>/eval-0-settings-wireframe/   prompt fixture (docs site + declared authority + gate)
#   <root>/with_new/                    copy to run with the current/deployed SKILL.md
#   <root>/with_old/                    copy to run with baselines/old-SKILL.md (previous version)
#   <root>/.control/pre.sha             source checksums (assertion 7)
#
# Usage: setup_fixtures.sh [target-dir]
# Default target: /tmp/opencode/designer-evals
set -euo pipefail

root="${1:-/tmp/opencode/designer-evals}"
here="$(cd "$(dirname "$0")" && pwd)"
fix="$root/eval-0-settings-wireframe"

rm -rf "$root"
mkdir -p "$fix/docs" "$fix/design/wireframes" "$fix/scripts" "$fix/assets" "$root/.control"

cat > "$fix/AGENTS.md" <<'EOF'
# Fixture docs site — agent rules

## Design authority
- Single source of truth for tokens: `assets/tokens.css` (vars only; never edit).
- Wireframes and design docs live in `design/`. Implementation source is `docs/` and is out of scope for design tasks.
- Design gate: `bash scripts/check-wireframes.sh` must exit 0 after any `design/` change.

## Project conventions
- Brand: ink + cyan, docs-site tone; no external CDNs or webfonts anywhere.
EOF

cat > "$fix/assets/tokens.css" <<'EOF'
:root {
  --ink: #1b1f24;
  --paper: #f7f5f0;
  --cyan: #00a6b2;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --font-display: "Charter", Georgia, serif;
  --font-body: "Avenir Next", system-ui, sans-serif;
  --radius: 6px;
}
EOF

cat > "$fix/docs/index.html" <<'EOF'
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixture Docs</title></head>
<body>
  <nav><a href="/">Home</a> <a href="/guide">Guide</a></nav>
  <main><h1>Fixture docs</h1></main>
</body>
</html>
EOF

cat > "$fix/scripts/check-wireframes.sh" <<'EOF'
#!/usr/bin/env bash
# Design gate: every design/wireframes/*.html must be self-contained (no external refs)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
shopt -s nullglob
files=("$root"/design/wireframes/*.html)
if [ ${#files[@]} -eq 0 ]; then
  echo "FAIL: no wireframes found in design/wireframes/"
  exit 1
fi
for f in "${files[@]}"; do
  rel="${f#"$root"/}"
  if grep -qiE 'src="https?://|href="https?://|@import|cdn\.' "$f"; then
    echo "FAIL: $rel references external resources"
    fail=1
  fi
  if ! grep -q -- '--cyan' "$f"; then
    echo "FAIL: $rel does not carry the project tokens"
    fail=1
  fi
  echo "OK: $rel"
done
exit $fail
EOF
chmod +x "$fix/scripts/check-wireframes.sh"

chmod +x "$here/examples/"*.html "$here/examples/"*.md 2>/dev/null || true

# Validate: the recorded run satisfies every assertion.
if [ -f "$here/examples/recorded-run.html" ]; then
  e="$here/examples/recorded-run.html"
  ok=1
  for t in '#1b1f24' '#f7f5f0' '#00a6b2' '--font-display' '--font-body' '--radius'; do
    grep -q -- "$t" "$e" || { echo "VALIDATION FAIL: recorded run missing token $t" >&2; ok=0; }
  done
  for t in 'empty' 'loading' 'error' 'partial' 'hover' 'focus-visible' 'disabled'; do
    grep -qi -- "$t" "$e" || { echo "VALIDATION FAIL: recorded run missing state $t" >&2; ok=0; }
  done
  grep -q 'Handoff contract' "$e" || { echo "VALIDATION FAIL: recorded run missing Handoff contract" >&2; ok=0; }
  grep -q 'check-wireframes.sh' "$e" || { echo "VALIDATION FAIL: recorded run missing gate command" >&2; ok=0; }
  [ "$ok" = 1 ] && echo "recorded run validates against evals.json assertions"
fi

cp -r "$fix" "$root/with_new"
cp -r "$fix" "$root/with_old"
(cd "$fix" && sha256sum AGENTS.md assets/tokens.css docs/index.html scripts/check-wireframes.sh \
  > "$root/.control/pre.sha")

echo "fixture ready:"
echo "  with_new  -> $root/with_new  (run with the current SKILL.md)"
echo "  with_old  -> $root/with_old  (run with baselines/old-SKILL.md)"
echo "  control   -> $root/.control/pre.sha"
