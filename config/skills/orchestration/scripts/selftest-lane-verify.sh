#!/usr/bin/env bash
# selftest-lane-verify.sh — self-contained, self-cleaning tests for
# lane-verify.sh (feature: "crumbs in lanes"). No network.
#
# Fixture: a throwaway git repo (basename = <prefix>) with two crumbs in lane
# `a`: T1 -> src/x.sh (gate `test -f src/x.sh`), T2 -> src/y.sh.
#
#   ok - (a) out-of-scope change caught, gates pass, RED
#   ok - (b) clean tree -> GREEN + verified rc= markers
#   ok - (c) rollback restores modified/deleted + deletes snapshot-absent file
#   ok - (d) `..` path manifest refused (exit 2), outside file untouched
#   ok - (e) malformed manifest (missing gate) refused, nothing executed
#   ok - (f) non-git worktree refused (exit 2)
#   ok - (g) [lane] filters gates only; declared union is every manifest row
#   ok - (h) snapshot containment guards refused (==/inside/ancestor/via
#            symlink); unmarked non-empty snapdir left intact
#   ok - (i) refused snapshot leaves a prior valid snapshot's files.lst intact
set -uo pipefail

HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SCRIPT="$HERE/lane-verify.sh"
[ -x "$SCRIPT" ] || [ -f "$SCRIPT" ] || { echo "FAIL - lane-verify.sh not found beside selftest" >&2; exit 1; }

fail() { echo "not ok - $*" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf -- "$TMP"' EXIT

WT="$TMP/repo"
SNAP="$TMP/snap"
PREFIX=$(basename -- "$WT")

mkdir -p -- "$WT" || fail "mkdir fixture"
git -C "$WT" init -q || fail "git init"
git -C "$WT" -c user.email=t@example.invalid -c user.name=t \
  commit --allow-empty -q -m init || fail "git commit"

MAN="$TMP/$PREFIX-tasks.tsv"
{
  printf 'a\tT1\tsrc/x.sh\t-\ttest -f src/x.sh\n'
  printf 'a\tT2\tsrc/y.sh\t-\ttest -f src/y.sh\n'
} > "$MAN"

# ── (a) snapshot -> create declared + out-of-scope -> check = RED, gates pass ─
bash "$SCRIPT" snapshot "$WT" "$SNAP" "$MAN" >/dev/null 2>&1 || fail "(a) snapshot failed"
mkdir -p -- "$WT/src"
printf 'x\n' > "$WT/src/x.sh"
printf 'y\n' > "$WT/src/y.sh"
printf 'z\n' > "$WT/src/z.sh"

out=$(bash "$SCRIPT" check "$WT" "$SNAP" "$MAN" 2>&1); rc=$?
[ "$rc" -eq 1 ] || fail "(a) expected exit 1, got $rc"
[ "$(printf '%s\n' "$out" | grep -c '| 0$')" -eq 2 ] || fail "(a) expected both gates rc=0"
printf '%s\n' "$out" | grep -q 'UNCLAIMED src/z.sh' || fail "(a) src/z.sh not flagged"
printf '%s\n' "$out" | grep -q 'verdict: RED' || fail "(a) verdict not RED"
echo "ok - (a) out-of-scope src/z.sh caught, gates pass, verdict RED, exit $rc"

# ── (b) remove the stray file -> snapshot-present x,y now clean -> GREEN ─────
rm -f -- "$WT/src/z.sh"
printf 'rc=0\n' > "$TMP/$PREFIX-T1-return.md"
printf 'rc=0\n' > "$TMP/$PREFIX-T2-return.md"

out=$(bash "$SCRIPT" check "$WT" "$SNAP" "$MAN" 2>&1); rc=$?
[ "$rc" -eq 0 ] || fail "(b) expected exit 0, got $rc"
printf '%s\n' "$out" | grep -q 'verdict: GREEN' || fail "(b) verdict not GREEN"
grep -q 'verified rc=0' "$TMP/$PREFIX-T1-return.md" || fail "(b) T1 marker missing"
grep -q 'verified rc=0' "$TMP/$PREFIX-T2-return.md" || fail "(b) T2 marker missing"
echo "ok - (b) clean tree -> GREEN, exit $rc, verified rc= markers appended"

# ── (c) fresh snapshot -> mutate -> rollback restores/delete -----------------
# T3 declares src/new.sh (absent at snapshot) so rollback must delete it.
MANC="$TMP/$PREFIX-tasks-c.tsv"
{
  printf 'a\tT1\tsrc/x.sh\t-\ttest -f src/x.sh\n'
  printf 'a\tT2\tsrc/y.sh\t-\ttest -f src/y.sh\n'
  printf 'a\tT3\tsrc/new.sh\t-\ttest -f src/new.sh\n'
} > "$MANC"
rm -f -- "$WT/src/new.sh"
bash "$SCRIPT" snapshot "$WT" "$SNAP" "$MANC" >/dev/null 2>&1 || fail "(c) snapshot failed"
grep -q '^present src/x.sh$' "$SNAP/files.lst" || fail "(c) x not present at snapshot"
grep -q '^absent src/new.sh$' "$SNAP/files.lst" || fail "(c) new.sh not absent at snapshot"

printf 'mutated\n' > "$WT/src/x.sh"
rm -f -- "$WT/src/y.sh"
printf 'created\n' > "$WT/src/new.sh"

bash "$SCRIPT" rollback "$WT" "$SNAP" "$MANC" >/dev/null 2>&1 || fail "(c) rollback failed"
[ "$(cat "$WT/src/x.sh")" = "x" ] || fail "(c) x.sh not restored to snapshot content"
[ "$(cat "$WT/src/y.sh")" = "y" ] || fail "(c) y.sh not restored after delete"
[ ! -e "$WT/src/new.sh" ] || fail "(c) snapshot-absent new.sh not deleted"
echo "ok - (c) rollback restored x.sh + deleted-and-restored y.sh, deleted snapshot-absent new.sh"

# ── (d) `..` path manifest refused; outside file left intact ----------------
OUT="$TMP/outside.txt"
printf 'keep\n' > "$OUT"
MAND="$TMP/$PREFIX-tasks-d.tsv"
printf 'a\tT4\t../outside.txt\t-\ttest -f src/x.sh\n' > "$MAND"

out=$(bash "$SCRIPT" snapshot "$WT" "$SNAP" "$MAND" 2>&1); rc=$?
[ "$rc" -eq 2 ] || fail "(d) snapshot expected exit 2, got $rc"
printf '%s\n' "$out" | grep -q 'path escapes worktree' || fail "(d) no escape message"
[ -f "$OUT" ] && [ "$(cat "$OUT")" = "keep" ] || fail "(d) outside file not intact after snapshot"

out=$(bash "$SCRIPT" rollback "$WT" "$SNAP" "$MAND" 2>&1); rc=$?
[ "$rc" -eq 2 ] || fail "(d) rollback expected exit 2, got $rc"
[ -f "$OUT" ] && [ "$(cat "$OUT")" = "keep" ] || fail "(d) outside file deleted by rollback"
echo "ok - (d) '..' manifest refused (exit $rc), outside file intact"

# ── (e) malformed manifest (missing gate) refused; nothing executed ----------
SENT="$TMP/executed.marker"
MANE="$TMP/$PREFIX-tasks-e.tsv"
{
  printf 'a\tT7\tsrc/x.sh\t-\ttouch %s\n' "$SENT"
  printf 'a\tT8\tsrc/y.sh\t-\n'
} > "$MANE"
rm -f -- "$SENT"

out=$(bash "$SCRIPT" check "$WT" "$SNAP" "$MANE" 2>&1); rc=$?
[ "$rc" -eq 2 ] || fail "(e) expected exit 2, got $rc"
[ ! -e "$SENT" ] || fail "(e) a gate executed despite the malformed manifest"
printf '%s\n' "$out" | grep -q 'manifest line 2' || fail "(e) error did not name line 2"
echo "ok - (e) malformed manifest refused (exit $rc), nothing executed"

# ── (f) non-git worktree refused --------------------------------------------
PLAIN="$TMP/plain"
mkdir -p -- "$PLAIN"
MANS="$TMP/$PREFIX-tasks-s.tsv"
printf 'a\tT1\tsrc/x.sh\t-\ttest -f src/x.sh\n' > "$MANS"
bash "$SCRIPT" snapshot "$PLAIN" "$TMP/snap-plain" "$MANS" >/dev/null 2>&1 || fail "(f) snapshot on plain dir failed"
out=$(bash "$SCRIPT" check "$PLAIN" "$TMP/snap-plain" "$MANS" 2>&1); rc=$?
[ "$rc" -eq 2 ] || fail "(f) expected exit 2, got $rc"
printf '%s\n' "$out" | grep -q 'not a git worktree' || fail "(f) no non-git message"
echo "ok - (f) non-git worktree refused (exit $rc)"

# ── (g) [lane] filters gates only; declared union is every manifest row ------
MANG="$TMP/$PREFIX-tasks-g.tsv"
{
  printf 'a\tT1\tsrc/x.sh\t-\ttest -f src/x.sh\n'
  printf 'a\tT2\tsrc/y.sh\t-\ttest -f src/y.sh\n'
  printf 'b\tT9\tsrc/b.sh\t-\ttest -f src/b.sh\n'
} > "$MANG"
rm -f -- "$WT/src/b.sh"
bash "$SCRIPT" snapshot "$WT" "$SNAP" "$MANG" >/dev/null 2>&1 || fail "(g) snapshot failed"
printf 'b\n' > "$WT/src/b.sh"
out=$(bash "$SCRIPT" check "$WT" "$SNAP" "$MANG" a 2>&1); rc=$?
[ "$rc" -eq 0 ] || fail "(g) expected exit 0, got $rc"
printf '%s\n' "$out" | grep -q 'UNCLAIMED src/b.sh' && fail "(g) other lane's declared file flagged UNCLAIMED"
printf '%s\n' "$out" | grep -q 'T9' && fail "(g) other lane's gate ran"
printf '%s\n' "$out" | grep -q 'verdict: GREEN' || fail "(g) verdict not GREEN"
echo "ok - (g) [lane] filters gates only; declared union honored"

# ── (h) snapshot containment guards; unmarked non-empty dir left intact ------
MANH="$TMP/$PREFIX-tasks-h.tsv"
printf 'a\tT1\tsrc/x.sh\t-\ttest -f src/x.sh\n' > "$MANH"

grefuse() { # <snapdir> <label>
  local out rc
  out=$(bash "$SCRIPT" snapshot "$WT" "$1" "$MANH" 2>&1); rc=$?
  [ "$rc" -eq 2 ] || fail "(h) $2: expected exit 2, got $rc"
  printf '%s\n' "$out" | grep -q 'snapdir' || fail "(h) $2: no snapdir refusal message"
}

grefuse "$WT" "snapdir == worktree"
grefuse "$WT/sub" "snapdir inside worktree"
grefuse "$TMP" "snapdir ancestor of worktree"
LINK="$TMP/repolink"
ln -s -- "$WT" "$LINK"
grefuse "$LINK" "snapdir via symlink to worktree"

GUARD="$TMP/guard-dir"
mkdir -p -- "$GUARD"
printf 'keep\n' > "$GUARD/keep.txt"
out=$(bash "$SCRIPT" snapshot "$WT" "$GUARD" "$MANH" 2>&1); rc=$?
[ "$rc" -eq 2 ] || fail "(h) unmarked non-empty dir: expected exit 2, got $rc"
printf '%s\n' "$out" | grep -q 'refusing to remove non-empty snapdir' || fail "(h) no non-empty refusal"
[ -f "$GUARD/keep.txt" ] && [ "$(cat "$GUARD/keep.txt")" = "keep" ] || fail "(h) unmarked non-empty dir was modified"
echo "ok - (h) containment guards refused (exit $rc); unmarked non-empty snapdir intact"

# ── (i) a refused snapshot leaves a PRIOR valid snapshot untouched -----------
SNAPI="$TMP/snap-i"
bash "$SCRIPT" snapshot "$WT" "$SNAPI" "$MANH" >/dev/null 2>&1 || fail "(i) initial snapshot failed"
before=$(cat "$SNAPI/files.lst")
out=$(bash "$SCRIPT" snapshot "$WT" "$SNAPI" "$MAND" 2>&1); rc=$?
[ "$rc" -eq 2 ] || fail "(i) bad-row snapshot expected exit 2, got $rc"
printf '%s\n' "$out" | grep -q 'path escapes worktree' || fail "(i) no escape message"
[ -d "$SNAPI" ] || fail "(i) prior snapshot dir removed by refused snapshot"
[ "$(cat "$SNAPI/files.lst")" = "$before" ] || fail "(i) prior files.lst clobbered by refused snapshot"
echo "ok - (i) refused snapshot left prior snapshot state intact"

echo "PASS - all lane-verify scenarios"
exit 0
