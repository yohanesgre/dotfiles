#!/usr/bin/env bash
# Self-test for plan-check.sh's crumb (## Tasks) rules.
# Runs entirely in temp dirs (mktemp -d + trap): no network, no repo pollution.
# Exit 0 = all checks passed; first failure prints one message and exits non-zero.
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLAN_CHECK="$SCRIPT_DIR/plan-check.sh"

TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT

PASS=0
fail() { echo "SELFTEST FAIL: $*" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); echo "ok - $*"; }
contains() { grep -Fq -- "$2" <<<"$1"; }

[ -f "$PLAN_CHECK" ] || fail "plan-check.sh not found at $PLAN_CHECK"

# newcase <name>: build a minimal well-formed status/ tree; caller writes plan.md.
CASE=""
newcase() {
  CASE="$TMP/$1"
  mkdir -p "$CASE/status/$1"
  printf '| %s | WORKING | 2026-01-01 |\n' "$1" > "$CASE/status/TIMELINE.md"
  printf 'state: WORKING\nts: 2026-01-01T00:00:00Z\nmsg: fixture\n' > "$CASE/status/$1/status.md"
}

# runcheck <case> <plan>: run plan-check with cwd in the fixture; sets OUT and RC.
# GIT_CEILING_DIRECTORIES keeps git rev-parse from escaping the temp tree.
OUT=""
RC=0
runcheck() {
  OUT=$(cd "$1" && GIT_CEILING_DIRECTORIES="$TMP" bash "$PLAN_CHECK" "$2" 2>&1)
  RC=$?
}

# --- (a) well-formed crumb plan -> exit 0 ------------------------------------
newcase good
cat > "$CASE/status/good/plan.md" <<'EOF'
# Plan: good

## Scope
Out: nothing in particular

## Tasks
### lane-a
| id | owner | files | resources | acceptance | gate | edges |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | swe | a.sh | — | verify: bash a.sh | bash a.sh |  |
| T2 | swe | b.sh | — | verify: bash b.sh | bash b.sh |  |

## Acceptance
- verify: bash a.sh && bash b.sh
EOF
runcheck "$CASE" good
[ "$RC" -eq 0 ] || fail "(a) expected exit 0 for a well-formed crumb plan, got $RC"
contains "$OUT" "crumbs in 1 lane" || fail "(a) missing well-formed crumbs confirmation"
ok "(a) well-formed crumb plan exits 0"

# --- (b) two crumbs share a file without an edge -> non-zero + share message --
newcase share
cat > "$CASE/status/share/plan.md" <<'EOF'
# Plan: share

## Scope
Out: nothing in particular

## Tasks
### lane-a
| id | owner | files | resources | acceptance | gate | edges |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | swe | a.sh | — | verify: x | bash x |  |
| T2 | swe | a.sh | — | verify: y | bash y |  |

## Acceptance
- verify: bash x
EOF
runcheck "$CASE" share
[ "$RC" -ne 0 ] || fail "(b) expected non-zero for a shared file without an edge, got 0"
contains "$OUT" "share file a.sh without an edge" || fail "(b) missing file-overlap message"
ok "(b) shared file without an edge fails with a share message"

# --- (c) same overlap WITH a direct edge -> exit 0 ---------------------------
newcase edged
cat > "$CASE/status/edged/plan.md" <<'EOF'
# Plan: edged

## Scope
Out: nothing in particular

## Tasks
### lane-a
| id | owner | files | resources | acceptance | gate | edges |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | swe | a.sh | — | verify: x | bash x | T2 |
| T2 | swe | a.sh | — | verify: y | bash y |  |

## Acceptance
- verify: bash x
EOF
runcheck "$CASE" edged
[ "$RC" -eq 0 ] || fail "(c) expected exit 0 for an edge-covered overlap, got $RC"
contains "$OUT" "share file" && fail "(c) false-positive file-overlap on an edged pair"
ok "(c) shared file with a direct edge exits 0"

# --- (d) edge referencing a missing id -> non-zero ---------------------------
newcase badedge
cat > "$CASE/status/badedge/plan.md" <<'EOF'
# Plan: badedge

## Scope
Out: nothing in particular

## Tasks
### lane-a
| id | owner | files | resources | acceptance | gate | edges |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | swe | a.sh | — | verify: x | bash x | T9 |

## Acceptance
- verify: bash x
EOF
runcheck "$CASE" badedge
[ "$RC" -ne 0 ] || fail "(d) expected non-zero for an edge to a missing id, got 0"
contains "$OUT" "edge T9 not found" || fail "(d) missing dangling-edge message"
ok "(d) edge referencing a missing id fails"

# --- (e) missing gate -> non-zero --------------------------------------------
newcase nogate
cat > "$CASE/status/nogate/plan.md" <<'EOF'
# Plan: nogate

## Scope
Out: nothing in particular

## Tasks
### lane-a
| id | owner | files | resources | acceptance | gate | edges |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | swe | a.sh | — | verify: x |  |  |

## Acceptance
- verify: bash x
EOF
runcheck "$CASE" nogate
[ "$RC" -ne 0 ] || fail "(e) expected non-zero for a missing gate, got 0"
contains "$OUT" "missing gate" || fail "(e) missing gate message"
ok "(e) crumb without a gate fails"

# --- (f) files: — placeholder -> non-zero ------------------------------------
newcase placeholder
cat > "$CASE/status/placeholder/plan.md" <<'EOF'
# Plan: placeholder

## Scope
Out: nothing in particular

## Tasks
### lane-a
| id | owner | files | resources | acceptance | gate | edges |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | swe | — | — | verify: x | bash x |  |

## Acceptance
- verify: bash x
EOF
runcheck "$CASE" placeholder
[ "$RC" -ne 0 ] || fail "(f) expected non-zero for a files placeholder, got 0"
contains "$OUT" "files placeholder" || fail "(f) missing files-placeholder message"
ok "(f) files: — placeholder fails"

# --- (g) space-separated resource overlap -> non-zero ------------------------
newcase resshare
cat > "$CASE/status/resshare/plan.md" <<'EOF'
# Plan: resshare

## Scope
Out: nothing in particular

## Tasks
### lane-a
| id | owner | files | resources | acceptance | gate | edges |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | swe | a.sh | cpu disk | verify: x | bash x |  |
| T2 | swe | b.sh | disk net | verify: y | bash y |  |

## Acceptance
- verify: bash x
EOF
runcheck "$CASE" resshare
[ "$RC" -ne 0 ] || fail "(g) expected non-zero for a shared resource, got 0"
contains "$OUT" "share resource disk without an edge" || fail "(g) missing resource-overlap message"
ok "(g) space-separated resource overlap fails"

# --- (h) legacy plan without ## Tasks -> exit 0 and no Tasks messages --------
newcase legacy
cat > "$CASE/status/legacy/plan.md" <<'EOF'
# Plan: legacy

## Scope
Out: nothing in particular

Some prose, no Tasks section at all.
EOF
runcheck "$CASE" legacy
[ "$RC" -eq 0 ] || fail "(h) expected exit 0 for a legacy plan, got $RC"
contains "$OUT" "Tasks" && fail "(h) legacy plan emitted a Tasks message"
ok "(h) legacy plan without ## Tasks exits 0 without Tasks messages"

echo
echo "all $PASS checks passed"
exit 0
