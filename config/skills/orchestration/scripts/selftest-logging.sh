#!/usr/bin/env bash
# Self-test for the orchestration run-log scripts (runlog.sh, run-report.sh).
# Runs entirely in temp dirs via an ABSOLUTE ORCH_LOG fixture: no network, no
# repo pollution. Exit 0 = all checks passed; first failure prints a message
# and exits non-zero.
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RUNLOG="$SCRIPT_DIR/runlog.sh"
REPORT="$SCRIPT_DIR/run-report.sh"

TMP=$(mktemp -d) || exit 1
trap 'rm -rf "$TMP"' EXIT

PASS=0
fail() { echo "SELFTEST FAIL: $*" >&2; exit 1; }
ok()   { PASS=$((PASS + 1)); echo "ok  - $*"; }
contains() { grep -Fq -- "$2" <<<"$1"; }

command -v jq >/dev/null 2>&1 || fail "jq not found (required by both scripts)"
[ -f "$RUNLOG" ] || fail "runlog.sh not found at $RUNLOG"
[ -f "$REPORT" ] || fail "run-report.sh not found at $REPORT"

# --- (a) runlog.sh appends exactly one valid JSON line -----------------------
A_LOG="$TMP/a.jsonl"
: > "$A_LOG"
ORCH_LOG="$A_LOG" bash "$RUNLOG" lane plan=p1 lane=api rc=0 repo=should_not_win >/dev/null 2>&1 \
  || fail "(a) runlog.sh exited non-zero"

lines=$(wc -l < "$A_LOG")
[ "$lines" -eq 1 ] || fail "(a) expected exactly 1 appended line, got $lines"
jq -e 'has("kind") and has("ts") and has("repo")' "$A_LOG" >/dev/null 2>&1 \
  || fail "(a) line is missing kind/ts/repo"
jq -e '.kind == "lane"' "$A_LOG" >/dev/null 2>&1 \
  || fail "(a) kind is not 'lane'"
[ "$(jq -r '.repo' "$A_LOG")" != "should_not_win" ] \
  || fail "(a) reserved 'repo' key was overridden by the caller"
ok "(a) runlog.sh appends one valid JSON line with kind/ts/repo"

# --- (b) run-report.sh renders a fixture log correctly -----------------------
FIX="$TMP/fixture.jsonl"
cat > "$FIX" <<'EOF'
{"kind":"lane","ts":"2026-01-01T00:00:00Z","repo":"alpha","plan":"p1","lane":"api","rc":"0","dur_ms":"1000"}
{"kind":"lane","ts":"2026-01-01T00:00:10Z","repo":"alpha","plan":"p1","lane":"tests","rc":"1","dur_ms":"2000"}
{"kind":"lane","ts":"2026-01-01T00:00:20Z","repo":"alpha","plan":"p1","lane":"tests","rc":"1","dur_ms":"3000"}
{"kind":"plan","ts":"2026-01-01T00:01:00Z","repo":"alpha","plan":"p1","verdict":"FAIL","wall_s":"60","lanes":"2","prs":"0","iter":"2"}
{"kind":"fix","ts":"2026-01-01T00:02:00Z","repo":"alpha","plan":"p1","symptom":"flaky tests","change":"retry","before":"1","after":"0"}
EOF

B_OUT=$(ORCH_LOG="$FIX" bash "$REPORT" 2>&1) || fail "(b) run-report.sh exited non-zero"
contains "$B_OUT" "| alpha | p1 | 3 | 1 | 2 " \
  || fail "(b) missing lanes row with rc!=0 counts (expected | alpha | p1 | 3 | 1 | 2 ...)"
contains "$B_OUT" "repeated: alpha/p1/tests (2)" \
  || fail "(b) missing Signals entry for the repeated lane"
contains "$B_OUT" "flaky tests" \
  || fail "(b) missing Recent fixes entry"
ok "(b) report shows rc!=0 counts, repeated-lane signal, recent fix"

# --- (c) ORCH_REPO narrows the report ---------------------------------------
NFIX="$TMP/fixture-repos.jsonl"
cp "$FIX" "$NFIX"
printf '%s\n' \
  '{"kind":"lane","ts":"2026-01-01T00:03:00Z","repo":"beta","plan":"p9","lane":"web","rc":"1","dur_ms":"500"}' \
  >> "$NFIX"

C_ALL=$(ORCH_LOG="$NFIX" bash "$REPORT" 2>&1) || fail "(c) unfiltered report exited non-zero"
contains "$C_ALL" "beta" || fail "(c) fixture sanity: beta missing from the unfiltered report"

C_A=$(ORCH_REPO=alpha ORCH_LOG="$NFIX" bash "$REPORT" 2>&1) || fail "(c) filtered report exited non-zero"
contains "$C_A" "beta" && fail "(c) ORCH_REPO=alpha leaked another repo's rows"
contains "$C_A" "alpha/p1/tests" || fail "(c) ORCH_REPO=alpha dropped alpha rows"
ok "(c) ORCH_REPO=alpha narrows the report to alpha"

# --- (d) empty log ----------------------------------------------------------
E_LOG="$TMP/empty.jsonl"
: > "$E_LOG"
D_OUT=$(ORCH_LOG="$E_LOG" bash "$REPORT" 2>&1) || fail "(d) empty-log report exited non-zero"
[ "$D_OUT" = "no runs logged yet" ] || fail "(d) expected 'no runs logged yet', got: $D_OUT"
ok "(d) empty log prints 'no runs logged yet' and exits 0"

# --- (e) ORCH_SINCE narrows the report to a recent window -------------------
SFIX="$TMP/fixture-since.jsonl"
NOW_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cat > "$SFIX" <<EOF
{"kind":"lane","ts":"2020-01-01T00:00:00Z","repo":"gamma","plan":"pold","lane":"api","rc":"0","dur_ms":"1000"}
{"kind":"lane","ts":"$NOW_TS","repo":"gamma","plan":"pnew","lane":"api","rc":"0","dur_ms":"1000"}
EOF

E_ALL=$(ORCH_LOG="$SFIX" bash "$REPORT" 2>&1) || fail "(e) unfiltered since-fixture report exited non-zero"
contains "$E_ALL" "pold" || fail "(e) fixture sanity: old row missing without ORCH_SINCE"
contains "$E_ALL" "pnew" || fail "(e) fixture sanity: recent row missing without ORCH_SINCE"

E_1D=$(ORCH_SINCE=1d ORCH_LOG="$SFIX" bash "$REPORT" 2>&1) || fail "(e) ORCH_SINCE=1d report exited non-zero"
contains "$E_1D" "pnew" || fail "(e) ORCH_SINCE=1d dropped the recent row"
contains "$E_1D" "pold" && fail "(e) ORCH_SINCE=1d leaked the old row"
ok "(e) ORCH_SINCE=1d keeps the recent row and drops the old one"

# --- (f) ORCH_SINCE accepts <N>h and a literal YYYY-MM-DD -------------------
E_1H=$(ORCH_SINCE=1h ORCH_LOG="$SFIX" bash "$REPORT" 2>&1) || fail "(f) ORCH_SINCE=1h report exited non-zero"
contains "$E_1H" "pnew" || fail "(f) ORCH_SINCE=1h dropped the recent row"

E_LIT=$(ORCH_SINCE=2021-01-01 ORCH_LOG="$SFIX" bash "$REPORT" 2>&1) || fail "(f) literal-date report exited non-zero"
contains "$E_LIT" "pnew" || fail "(f) ORCH_SINCE=2021-01-01 dropped the recent row"
contains "$E_LIT" "pold" && fail "(f) ORCH_SINCE=2021-01-01 leaked the 2020 row"
ok "(f) ORCH_SINCE accepts <N>h and a literal YYYY-MM-DD cutoff"

# --- (g) window with no runs prints 'no runs in window' ---------------------
OFIX="$TMP/fixture-old-only.jsonl"
printf '%s\n' \
  '{"kind":"lane","ts":"2020-01-01T00:00:00Z","repo":"gamma","plan":"pold","lane":"api","rc":"0","dur_ms":"1000"}' \
  > "$OFIX"
G_OUT=$(ORCH_SINCE=1d ORCH_LOG="$OFIX" bash "$REPORT" 2>&1) || fail "(g) empty-window report exited non-zero"
[ "$G_OUT" = "no runs in window" ] || fail "(g) expected 'no runs in window', got: $G_OUT"
ok "(g) window with no matching runs prints 'no runs in window' and exits 0"

echo
echo "all $PASS checks passed"
exit 0
