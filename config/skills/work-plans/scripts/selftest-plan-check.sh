#!/usr/bin/env bash
# Self-test for plan-check.sh: external resolver root plus --root staging validation.
# Hermetic: temporary HOME/XDG_STATE_HOME, temporary Git repos, no network.
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PLAN_CHECK="$SCRIPT_DIR/plan-check.sh"
RESOLVER="$SCRIPT_DIR/plan-root.sh"

TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT

PASS=0
fail() { echo "SELFTEST FAIL: $*" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); echo "ok - $*"; }
contains() { grep -Fq -- "$2" <<<"$1"; }

[ -f "$PLAN_CHECK" ] || fail "plan-check.sh not found at $PLAN_CHECK"
[ -f "$RESOLVER" ] || fail "plan-root.sh not found at $RESOLVER"

HOME_TMP="$TMP/home"
mkdir -p "$HOME_TMP"
XDG="$TMP/xdg state"
REPO="$TMP/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q || fail "git init failed"
git -C "$REPO" -c user.name=selftest -c user.email=selftest@example.invalid \
  commit -q --allow-empty -m init || fail "git commit failed"

ROOT=$(cd "$REPO" && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR \
  -u XDG_STATE_HOME HOME="$HOME_TMP" XDG_STATE_HOME="$XDG" bash "$RESOLVER") \
  || fail "resolver failed for the fixture repo"
[ -n "$ROOT" ] || fail "resolver returned an empty fixture root"
mkdir -p "$ROOT"

OUT=""
RC=0
run_check() { # run_check <cwd> [args...]
  local dir=$1; shift
  OUT=$(cd "$dir" && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_COMMON_DIR \
    HOME="$HOME_TMP" XDG_STATE_HOME="$XDG" GIT_CEILING_DIRECTORIES="$TMP" \
    bash "$PLAN_CHECK" "$@" 2>&1)
  RC=$?
}
runcheck() { run_check "$REPO" "$1"; }

CASE_DIR=""
# newcase <name>: create an external plan folder, 3-line heartbeat, TIMELINE row.
newcase() {
  CASE_DIR="$ROOT/$1"
  mkdir -p "$CASE_DIR"
  printf '| %s | WORKING | 2026-01-01 |\n' "$1" >> "$ROOT/TIMELINE.md"
  printf 'state: WORKING\nts: 2026-01-01T00:00:00Z\nmsg: fixture\n' > "$CASE_DIR/status.md"
}

# --- (a) well-formed crumb plan -> exit 0 ------------------------------------
newcase good
cat > "$CASE_DIR/plan.md" <<'EOF'
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
runcheck good
[ "$RC" -eq 0 ] || fail "(a) expected exit 0 for a well-formed crumb plan, got $RC: $OUT"
contains "$OUT" "crumbs in 1 lane" || fail "(a) missing well-formed crumbs confirmation"
contains "$OUT" "GREEN for good" || fail "(a) missing GREEN summary"
ok "(a) well-formed crumb plan exits 0"

# --- (b) two crumbs share a file without an edge -> non-zero + share message --
newcase share
cat > "$CASE_DIR/plan.md" <<'EOF'
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
runcheck share
[ "$RC" -ne 0 ] || fail "(b) expected non-zero for a shared file without an edge, got 0"
contains "$OUT" "share file a.sh without an edge" || fail "(b) missing file-overlap message"
ok "(b) shared file without an edge fails with a share message"

# --- (c) same overlap WITH a direct edge -> exit 0 ---------------------------
newcase edged
cat > "$CASE_DIR/plan.md" <<'EOF'
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
runcheck edged
[ "$RC" -eq 0 ] || fail "(c) expected exit 0 for an edge-covered overlap, got $RC: $OUT"
contains "$OUT" "share file" && fail "(c) false-positive file-overlap on an edged pair"
ok "(c) shared file with a direct edge exits 0"

# --- (d) edge referencing a missing id -> non-zero ---------------------------
newcase badedge
cat > "$CASE_DIR/plan.md" <<'EOF'
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
runcheck badedge
[ "$RC" -ne 0 ] || fail "(d) expected non-zero for an edge to a missing id, got 0"
contains "$OUT" "edge T9 not found" || fail "(d) missing dangling-edge message"
ok "(d) edge referencing a missing id fails"

# --- (e) missing gate -> non-zero --------------------------------------------
newcase nogate
cat > "$CASE_DIR/plan.md" <<'EOF'
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
runcheck nogate
[ "$RC" -ne 0 ] || fail "(e) expected non-zero for a missing gate, got 0"
contains "$OUT" "missing gate" || fail "(e) missing gate message"
ok "(e) crumb without a gate fails"

# --- (f) files: — placeholder -> non-zero ------------------------------------
newcase placeholder
cat > "$CASE_DIR/plan.md" <<'EOF'
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
runcheck placeholder
[ "$RC" -ne 0 ] || fail "(f) expected non-zero for a files placeholder, got 0"
contains "$OUT" "files placeholder" || fail "(f) missing files-placeholder message"
ok "(f) files: — placeholder fails"

# --- (g) space-separated resource overlap -> non-zero ------------------------
newcase resshare
cat > "$CASE_DIR/plan.md" <<'EOF'
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
runcheck resshare
[ "$RC" -ne 0 ] || fail "(g) expected non-zero for a shared resource, got 0"
contains "$OUT" "share resource disk without an edge" || fail "(g) missing resource-overlap message"
ok "(g) space-separated resource overlap fails"

# --- (h) legacy plan without ## Tasks -> exit 0 and no Tasks messages --------
newcase legacy
cat > "$CASE_DIR/plan.md" <<'EOF'
# Plan: legacy

## Scope
Out: nothing in particular

Some prose, no Tasks section at all.
EOF
runcheck legacy
[ "$RC" -eq 0 ] || fail "(h) expected exit 0 for a legacy plan, got $RC: $OUT"
contains "$OUT" "Tasks" && fail "(h) legacy plan emitted a Tasks message"
ok "(h) legacy plan without ## Tasks exits 0 without Tasks messages"

# --- (i) DONE without report.md -> non-zero ----------------------------------
newcase done-noreport
cat > "$CASE_DIR/plan.md" <<'EOF'
# Plan: done-noreport

## Scope
Out: nothing in particular
EOF
printf 'state: DONE\nts: 2026-01-01T00:00:00Z\nmsg: closed\n' > "$CASE_DIR/status.md"
runcheck done-noreport
[ "$RC" -ne 0 ] || fail "(i) expected non-zero for DONE without report.md"
contains "$OUT" "DONE without report.md" || fail "(i) missing DONE/report message"
ok "(i) DONE without report.md fails"

# --- (j) invalid state enum -> non-zero --------------------------------------
newcase bad-state
cat > "$CASE_DIR/plan.md" <<'EOF'
# Plan: bad-state

## Scope
Out: nothing in particular
EOF
printf 'state: BOGUS\nts: 2026-01-01T00:00:00Z\nmsg: fixture\n' > "$CASE_DIR/status.md"
runcheck bad-state
[ "$RC" -ne 0 ] || fail "(j) expected non-zero for an invalid state"
contains "$OUT" "not in PLAN|WAIT|WORKING|DONE|FAILED" || fail "(j) missing enum message"
ok "(j) invalid state enum fails"

# --- (k) heartbeat that is not 3 lines -> non-zero ---------------------------
newcase short-heartbeat
cat > "$CASE_DIR/plan.md" <<'EOF'
# Plan: short-heartbeat

## Scope
Out: nothing in particular
EOF
printf 'state: WORKING\nts: 2026-01-01T00:00:00Z\n' > "$CASE_DIR/status.md"
runcheck short-heartbeat
[ "$RC" -ne 0 ] || fail "(k) expected non-zero for a 2-line heartbeat"
contains "$OUT" "want 3" || fail "(k) missing heartbeat length message"
ok "(k) non-3-line heartbeat fails"

# --- (l) missing TIMELINE row -> non-zero ------------------------------------
CASE_DIR="$ROOT/no-timeline"
mkdir -p "$CASE_DIR"
printf 'state: WORKING\nts: 2026-01-01T00:00:00Z\nmsg: fixture\n' > "$CASE_DIR/status.md"
cat > "$CASE_DIR/plan.md" <<'EOF'
# Plan: no-timeline

## Scope
Out: nothing in particular
EOF
runcheck no-timeline
[ "$RC" -ne 0 ] || fail "(l) expected non-zero for a missing TIMELINE row"
contains "$OUT" "TIMELINE missing no-timeline" || fail "(l) missing TIMELINE message"
ok "(l) missing TIMELINE row fails"

# --- (m) 3-line lane files pass ---------------------------------------------
newcase lanes
cat > "$CASE_DIR/plan.md" <<'EOF'
# Plan: lanes

## Scope
Out: nothing in particular
EOF
mkdir -p "$CASE_DIR/lanes"
printf 'state: WORKING\nts: 2026-01-01T00:00:00Z\nmsg: lane\n' > "$CASE_DIR/lanes/lane-a.md"
runcheck lanes
[ "$RC" -eq 0 ] || fail "(m) expected exit 0 for a 3-line lane, got $RC: $OUT"
contains "$OUT" "lane lane-a.md is 3 lines" || fail "(m) missing lane confirmation"
ok "(m) 3-line lane file passes"

# --- (n) malformed lane file -> non-zero -------------------------------------
newcase lanes-bad
cat > "$CASE_DIR/plan.md" <<'EOF'
# Plan: lanes-bad

## Scope
Out: nothing in particular
EOF
mkdir -p "$CASE_DIR/lanes"
printf 'state: WORKING\nts: 2026-01-01T00:00:00Z\n' > "$CASE_DIR/lanes/lane-b.md"
runcheck lanes-bad
[ "$RC" -ne 0 ] || fail "(n) expected non-zero for a 2-line lane file"
contains "$OUT" "want 3" || fail "(n) missing lane length message"
ok "(n) malformed lane file fails"

# --- (o) loose file in the tracking root -> non-zero -------------------------
newcase loose
cat > "$CASE_DIR/plan.md" <<'EOF'
# Plan: loose

## Scope
Out: nothing in particular
EOF
printf 'x\n' > "$ROOT/loose.md"
runcheck loose
[ "$RC" -ne 0 ] || fail "(o) expected non-zero for a loose file in the root"
contains "$OUT" "loose files in tracking root" || fail "(o) missing loose-file message"
rm -f "$ROOT/loose.md"
ok "(o) loose file in the tracking root fails"

# --- (p) default never falls back to repo-local status; no writes ------------
mkdir -p "$REPO/status/fallback-probe"
cat > "$REPO/status/fallback-probe/plan.md" <<'EOF'
# Plan: fallback-probe

## Scope
Out: nothing in particular
EOF
printf 'state: WORKING\nts: 2026-01-01T00:00:00Z\nmsg: repo-local\n' \
  > "$REPO/status/fallback-probe/status.md"
printf '| fallback-probe | WORKING | 2026-01-01 |\n' > "$REPO/status/TIMELINE.md"
BEFORE=$(find "$XDG" -print 2>/dev/null | sort)
runcheck fallback-probe
AFTER=$(find "$XDG" -print 2>/dev/null | sort)
[ "$RC" -eq 1 ] || fail "(p) expected RED (1) from the external root, got $RC: $OUT"
contains "$OUT" "$ROOT/fallback-probe/plan.md missing" \
  || fail "(p) default did not use the external root: $OUT"
[ "$BEFORE" = "$AFTER" ] || fail "(p) default check changed the external root"
[ ! -e "$ROOT/fallback-probe" ] || fail "(p) default check created a plan folder"
ok "(p) default reads only the external root and writes nothing"

# --- (q) default outside Git fails clearly -----------------------------------
mkdir -p "$TMP/nonrepo"
run_check "$TMP/nonrepo" some-plan
[ "$RC" -eq 2 ] || fail "(q) expected exit 2 outside Git, got $RC: $OUT"
contains "$OUT" "not inside a Git work tree" || fail "(q) missing clear non-repo diagnostic"
ok "(q) default outside Git fails clearly instead of using cwd"

# --- (r) --root validates a staging tree outside Git -------------------------
STAGE="$TMP/stage tree"
mkdir -p "$STAGE/staged"
printf '| staged | WORKING | 2026-01-01 |\n' > "$STAGE/TIMELINE.md"
printf 'state: WORKING\nts: 2026-01-01T00:00:00Z\nmsg: staged\n' > "$STAGE/staged/status.md"
cat > "$STAGE/staged/plan.md" <<'EOF'
# Plan: staged

## Scope
Out: nothing in particular
EOF
run_check "$TMP/nonrepo" --root "$STAGE" staged
[ "$RC" -eq 0 ] || fail "(r) expected staging validation to pass, got $RC: $OUT"
contains "$OUT" "GREEN for staged" || fail "(r) missing staging GREEN summary"
ok "(r) --root validates an absolute staging tree outside Git"

# --- (s) --root must be absolute and exist ----------------------------------
run_check "$REPO" --root "relative/root" staged
[ "$RC" -eq 2 ] || fail "(s) expected exit 2 for a relative --root, got $RC: $OUT"
contains "$OUT" "must be an absolute path" || fail "(s) missing absolute-path diagnostic"

run_check "$REPO" --root "$TMP/no-such-root" staged
[ "$RC" -eq 2 ] || fail "(s) expected exit 2 for a missing --root, got $RC: $OUT"
contains "$OUT" "does not exist" || fail "(s) missing nonexistent-root diagnostic"
ok "(s) --root rejects relative and nonexistent roots"

# --- (t) unsafe plan names are rejected --------------------------------------
for badplan in Bad_Name . .. "a b"; do
  run_check "$REPO" --root "$STAGE" "$badplan"
  [ "$RC" -eq 2 ] || fail "(t) expected exit 2 for plan name '$badplan', got $RC"
  contains "$OUT" "invalid plan name" || fail "(t) missing invalid-name diagnostic for '$badplan'"
done
ok "(t) unsafe plan names are rejected"

# --- (t2) option-shaped plan names are validated after --, never help -------
for optname in --help -h; do
  mkdir -p "$STAGE/$optname"
  printf 'state: WORKING\nts: 2026-01-01T00:00:00Z\nmsg: option\n' > "$STAGE/$optname/status.md"
  cat > "$STAGE/$optname/plan.md" <<'EOF'
# Plan: option-named

## Scope
Out: nothing in particular
EOF
  printf '| %s | WORKING | 2026-01-01 |\n' "$optname" >> "$STAGE/TIMELINE.md"
done
for optname in --help -h; do
  run_check "$REPO" --root "$STAGE" -- "$optname"
  [ "$RC" -eq 0 ] || fail "(t2) expected GREEN for plan '$optname' after --, got $RC: $OUT"
  contains "$OUT" "GREEN for $optname" || fail "(t2) plan '$optname' was not validated: $OUT"
  contains "$OUT" "usage: plan-check.sh" && fail "(t2) plan '$optname' after -- returned help success"
done
# Without --, the conventional help flags still short-circuit with exit 0.
run_check "$REPO" --help
[ "$RC" -eq 0 ] || fail "(t2) bare --help should remain conventional help, got $RC: $OUT"
contains "$OUT" "usage: plan-check.sh" || fail "(t2) bare --help lost the usage text"
# An invalid option-named plan must go RED, never return help success.
EMPTYROOT="$TMP/stage-empty"
mkdir -p "$EMPTYROOT"
printf '| --help | WORKING | 2026-01-01 |\n' > "$EMPTYROOT/TIMELINE.md"
run_check "$REPO" --root "$EMPTYROOT" -- --help
[ "$RC" -eq 1 ] || fail "(t2) invalid option-named plan should be RED (1), got $RC: $OUT"
contains "$OUT" "plan.md missing" || fail "(t2) invalid option-named plan was not validated: $OUT"
contains "$OUT" "usage: plan-check.sh" && fail "(t2) invalid option-named plan returned help success"
ok "(t2) option-shaped plan names validate after -- and never return help success"

# --- (u) linked worktree resolves the same external root --------------------
git -C "$REPO" worktree add -q "$TMP/wt" -b linked || fail "(u) worktree add failed"
run_check "$TMP/wt" good
[ "$RC" -eq 0 ] || fail "(u) expected GREEN from the linked worktree, got $RC: $OUT"
contains "$OUT" "GREEN for good" || fail "(u) missing GREEN summary from linked worktree"
ok "(u) linked worktree validates the same external plan"

echo
echo "all $PASS checks passed"
exit 0
