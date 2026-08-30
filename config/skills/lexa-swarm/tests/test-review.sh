#!/usr/bin/env bash
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -euo pipefail
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

git -C "$TMP" init -q -b main
git -C "$TMP" commit -q --allow-empty -m init
mkdir -p "$TMP/wireframes" "$TMP/app" "$TMP/server" "$TMP/cli" "$TMP/docs"

# PLAN.md with lane sections.
mkdir -p "$TMP/status"
cat > "$TMP/status/PLAN.md" <<'EOF'
# Feature plan

## Lane: be
Add /api/items. Contract: Item type in shared/types.ts, GET+POST.

## Lane: wf
Sketch the items page per DESIGN_SYSTEM.

## Lane: fe
Transcribe wf wireframe into app/routes/items.
EOF

# Brief extraction: be and wf extract; missing lane errors.
bash "$TEST_DIR/../scripts/brief-lane.sh" "$TMP" be
grep -q "/api/items" "$TMP/status/briefs/be.md" || { echo "FAIL: be brief wrong"; exit 1; }
bash "$TEST_DIR/../scripts/brief-lane.sh" "$TMP" fe
grep -q "app/routes/items" "$TMP/status/briefs/fe.md" || { echo "FAIL: fe brief wrong"; exit 1; }
if bash "$TEST_DIR/../scripts/brief-lane.sh" "$TMP" cli 2>/dev/null && [ -s "$TMP/status/briefs/cli.md" ]; then
  echo "FAIL: cli brief should be empty (no section)"
  exit 1
fi

# Review package: lane commit on its branch, manifest, diff package.
REPO="$TMP" FEATURE=test-lane WT_BASE="$TMP/wts" \
  bash "$TEST_DIR/../scripts/make-worktrees.sh" >/dev/null
git -C "$TMP/wts/lexa-be" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "be: contract"
bash "$TEST_DIR/../scripts/review-lane.sh" "$TMP" be
pkg="$TMP/status/reviews/be.md"
[ -f "$pkg" ] || { echo "FAIL: review package missing"; exit 1; }
grep -q "be: contract" "$pkg" || { echo "FAIL: package lacks commit"; exit 1; }
if bash "$TEST_DIR/../scripts/review-lane.sh" "$TMP" nope >/dev/null 2>&1; then
  echo "FAIL: unknown lane should error"
  exit 1
fi
echo "PASS"
