#!/usr/bin/env bash
# Self-test for migrate-status.sh.
#
# Deterministic and hermetic: every case builds a fresh temporary Git
# repository (plus linked worktree when relevant) and an isolated
# XDG_STATE_HOME. Nothing touches the real user state directory; no network.
# Exit 0 = all checks passed.
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MIGRATE="$SCRIPT_DIR/migrate-status.sh"
ROOT_RESOLVER="$SCRIPT_DIR/plan-root.sh"
VALIDATOR="$SCRIPT_DIR/plan-check.sh"

for required in "$MIGRATE" "$ROOT_RESOLVER" "$VALIDATOR"; do
  [ -e "$required" ] || { echo "SELFTEST FAIL: missing $required" >&2; exit 1; }
done

TMP=$(mktemp -d) || exit 1
OUTDIR="$TMP/out"
mkdir -p "$OUTDIR"
ALT=""
trap 'rm -rf "$TMP"; [ -n "${ALT:-}" ] && rm -rf "$ALT"' EXIT

PASS=0
fail() { echo "SELFTEST FAIL: $*" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); echo "ok - $*"; }
assert_eq() { [ "$1" = "$2" ] || fail "$3 (got '$1', want '$2')"; }
assert_true() { [ "$1" = "True" ] || fail "$2 (got '$1')"; }
assert_false() { [ "$1" = "False" ] || fail "$2 (got '$1')"; }

jget() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1]))
print(eval(sys.argv[2], {"d": data}))
PY
}
jtrue() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
data = json.load(open(sys.argv[1]))
sys.exit(0 if eval(sys.argv[2], {"d": data}) else 1)
PY
}

RC=0
run_migrate() {
  local dir="$1" out="$2" xdg="$3"
  shift 3
  ( cd "$dir" && XDG_STATE_HOME="$xdg" bash "$MIGRATE" "$@" >"$out" 2>"$out.err" )
  RC=$?
}
run_migrate_env() {
  local dir="$1" out="$2" xdg="$3" assignment="$4"
  shift 4
  ( cd "$dir" && env XDG_STATE_HOME="$xdg" "$assignment" bash "$MIGRATE" "$@" >"$out" 2>"$out.err" )
  RC=$?
}

new_repo() {
  git init -q "$1"
  git -C "$1" -c user.email=test@example.invalid -c user.name=test \
    commit -q --allow-empty -m init
}

write_plan() {
  cat > "$1/plan.md" <<EOF
# Plan: $2

## Scope
- In: fixture work
- Out: nothing
EOF
}
write_status() {
  printf 'state: %s\nts: 2026-01-01T00:00:00Z\nmsg: fixture\n' "$2" > "$1/status.md"
}
write_report() {
  printf '# Report: %s\nresult: fixture\n' "$2" > "$1/report.md"
}
timeline_add() {
  printf '%s | %s | %s | fixture | status/%s/plan.md\n' "$2" "$3" "$4" "$3" >> "$1/TIMELINE.md"
}
add_plan() {
  local status="$1" name="$2" state="${3:-WORKING}" date="${4:-2026-01-01}"
  mkdir -p "$status/$name"
  write_plan "$status/$name" "$name"
  write_status "$status/$name" "$state"
  if [ "$state" = DONE ] || [ "$state" = FAILED ]; then
    write_report "$status/$name" "$name"
  fi
  timeline_add "$status" "$date" "$name" "$state"
}
add_archive_plan() {
  local status="$1" dir="$2" name="$3" state="${4:-DONE}" date="${5:-2026-01-02}"
  mkdir -p "$status/archive/$dir"
  write_plan "$status/archive/$dir" "$name"
  write_status "$status/archive/$dir" "$state"
  write_report "$status/archive/$dir" "$name"
  printf '%s | %s | %s | archived fixture | status/archive/%s/plan.md\n' \
    "$date" "$name" "$state" "$dir" >> "$status/TIMELINE.md"
}
snapshot() {
  {
    find "$1" -mindepth 1 -printf '%P|%y|%s|%T@\n' | sort
    find "$1" -type f -exec sha256sum {} + 2>/dev/null | sort
  } > "$2"
}
resolved_root() {
  ( cd "$1" && XDG_STATE_HOME="$2" bash "$ROOT_RESOLVER" )
}
inside_root() {
  case "$1" in
    "$2"|"$2"/*) return 0 ;;
    *) return 1 ;;
  esac
}

# --- 1: dry-run is read-only and maps control + linked worktrees ------------
CASE="$TMP/case01"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
git -C "$CASE/repo" worktree add -q "$CASE/linked" -b linked
add_plan "$CASE/linked/status" beta
snapshot "$CASE/repo" "$CASE/repo.before"
snapshot "$CASE/linked" "$CASE/linked.before"

OUT="$OUTDIR/case01.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state"
assert_eq "$RC" "0" "case1 dry-run exit"
assert_true "$(jget "$OUT" 'd["ok"]')" "case1 ok"
assert_eq "$(jget "$OUT" 'd["status"]')" "inventory" "case1 status"
assert_false "$(jget "$OUT" 'd["will_write"]')" "case1 will_write"
assert_true "$(jget "$OUT" 'd["would_apply"]')" "case1 would_apply"
assert_eq "$(jget "$OUT" 'len(d["sources"])')" "2" "case1 discovered sources"
assert_eq "$(jget "$OUT" 'sorted(p["name"] for p in d["plans"])')" "['alpha', 'beta']" "case1 plans"
ROOT1=$(jget "$OUT" 'd["destination"]["root"]')
inside_root "$ROOT1" "$CASE/state/work-plans" || fail "case1 destination not under XDG state: $ROOT1"
snapshot "$CASE/repo" "$CASE/repo.after"
snapshot "$CASE/linked" "$CASE/linked.after"
cmp -s "$CASE/repo.before" "$CASE/repo.after" || fail "case1 dry-run modified the control repo"
cmp -s "$CASE/linked.before" "$CASE/linked.after" || fail "case1 dry-run modified the linked worktree"
[ ! -e "$CASE/state" ] || fail "case1 dry-run created state files"
ok "dry-run maps sources, writes nothing"

# --- 2: apply, merge, rewrite scope, chronology, dedupe, backup -------------
CASE="$TMP/case02"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
cat >> "$CASE/repo/status/alpha/plan.md" <<'PLANEOF'

Tracking: see status/alpha/report.md and status/TIMELINE.md.
Implementation: config/status/widget.sh and /tmp/status/alpha/raw.txt.
Evidence: git log -- status/alpha/plan.md
$ cat status/alpha/plan.md

```text
bash ~/.agents/skills/work-plans/scripts/plan-check.sh status/alpha
```
PLANEOF
printf '2026-01-05 | alpha | WORKING | late evidence | status/alpha/plan.md\n' >> "$CASE/repo/status/TIMELINE.md"
printf '2026-01-01 | alpha | PLAN | early evidence | status/alpha/plan.md\n' >> "$CASE/repo/status/TIMELINE.md"
git -C "$CASE/repo" worktree add -q "$CASE/linked" -b linked
add_plan "$CASE/linked/status" beta
printf '2026-01-03 | beta | WORKING | mid evidence | status/beta/plan.md\n' >> "$CASE/linked/status/TIMELINE.md"
DUP='2026-01-02 | alpha | WORKING | shared evidence | status/alpha/plan.md'
printf '%s\n' "$DUP" >> "$CASE/repo/status/TIMELINE.md"
printf '%s\n' "$DUP" >> "$CASE/linked/status/TIMELINE.md"
printf 'Absolute tracking: %s/status/alpha/plan.md and %s/status/TIMELINE.md\n' \
  "$CASE/repo" "$CASE/repo" >> "$CASE/repo/status/alpha/plan.md"
printf 'Absolute plan dir: %s/status/alpha\n' "$CASE/repo" >> "$CASE/repo/status/alpha/plan.md"
printf 'Absolute implementation: %s/status/alpha/raw.txt\n' "$CASE/repo" >> "$CASE/repo/status/alpha/plan.md"
printf '```text\ncat %s/status/alpha/plan.md\n```\n' "$CASE/repo" >> "$CASE/repo/status/alpha/plan.md"
printf '2026-01-02 | alpha | WORKING | absolute link | %s/status/alpha/plan.md\n' \
  "$CASE/repo" >> "$CASE/repo/status/TIMELINE.md"
ORIG_SHA=$(sha256sum "$CASE/repo/status/alpha/plan.md" | cut -d' ' -f1)
ORIG_MTIME=$(stat -c %Y "$CASE/repo/status/alpha/plan.md")

OUT="$OUTDIR/case02.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "0" "case2 apply exit"
assert_eq "$(jget "$OUT" 'd["status"]')" "applied" "case2 status"
assert_eq "$(jget "$OUT" 'd["manifest"]["state"]')" "retired" "case2 manifest state"
ROOT2=$(jget "$OUT" 'd["destination"]["root"]')
[ -f "$ROOT2/TIMELINE.md" ] || fail "case2 missing merged TIMELINE"
[ -f "$ROOT2/alpha/plan.md" ] || fail "case2 missing alpha plan"
[ -f "$ROOT2/beta/plan.md" ] || fail "case2 missing beta plan"
[ ! -e "$CASE/repo/status" ] || fail "case2 control source not retired"
[ ! -e "$CASE/linked/status" ] || fail "case2 linked source not retired"
grep -Fq 'see alpha/report.md' "$ROOT2/alpha/plan.md" || fail "case2 tracking link not rewritten"
grep -Fq 'TIMELINE.md' "$ROOT2/alpha/plan.md" || fail "case2 timeline link not rewritten"
grep -Fq 'status/TIMELINE.md' "$ROOT2/alpha/plan.md" && fail "case2 old status/TIMELINE link survived"
grep -Fq 'config/status/widget.sh' "$ROOT2/alpha/plan.md" || fail "case2 implementation path lost"
grep -Fq '/tmp/status/alpha/raw.txt' "$ROOT2/alpha/plan.md" || fail "case2 absolute path rewritten"
grep -Fq 'plan-check.sh status/alpha' "$ROOT2/alpha/plan.md" || fail "case2 fenced command evidence rewritten"
grep -Fq 'git log -- status/alpha/plan.md' "$ROOT2/alpha/plan.md" || fail "case2 git-history evidence rewritten"
grep -Fq '$ cat status/alpha/plan.md' "$ROOT2/alpha/plan.md" || fail "case2 shell-prompt evidence rewritten"
grep -Fq 'Absolute tracking: alpha/plan.md and TIMELINE.md' "$ROOT2/alpha/plan.md" \
  || fail "case2 absolute tracking links not rewritten"
grep -Fq 'Absolute plan dir: alpha' "$ROOT2/alpha/plan.md" \
  || fail "case2 absolute plan directory not rewritten"
grep -Fq "Absolute implementation: $CASE/repo/status/alpha/raw.txt" "$ROOT2/alpha/plan.md" \
  || fail "case2 unrelated absolute implementation path rewritten"
grep -Fq "cat $CASE/repo/status/alpha/plan.md" "$ROOT2/alpha/plan.md" \
  || fail "case2 fenced absolute evidence rewritten"
grep -Fq '| absolute link | alpha/plan.md' "$ROOT2/TIMELINE.md" \
  || fail "case2 absolute timeline link not rewritten"
jtrue "$OUT" 'any(f["path"] == "alpha/plan.md" and f.get("evidence_skipped", 0) >= 2 for f in d["rewrites"]["files"])' \
  || fail "case2 evidence skips not recorded"
[ "$(grep -c 'shared evidence' "$ROOT2/TIMELINE.md")" = "1" ] || fail "case2 identical timeline entry not deduped"
jtrue "$OUT" 'any("shared evidence" in e["line"] and e["count"] == 2 for e in d["timeline"]["deduped"])' \
  || fail "case2 timeline dedupe not explained"
DATES=$(awk -F'|' '{gsub(/[[:space:]]/, "", $1); print $1}' "$ROOT2/TIMELINE.md")
[ "$DATES" = "$(printf '%s\n' "$DATES" | sort)" ] || fail "case2 timeline chronology not sorted"
[ "$(jget "$OUT" 'd["timeline"]["entries"]')" = "7" ] || fail "case2 unexpected timeline entry count"
jtrue "$OUT" 'any(f["path"] == "alpha/plan.md" and f["replacements"] >= 2 for f in d["rewrites"]["files"])' \
  || fail "case2 rewrite manifest incomplete"
BACKUP2=$(jget "$OUT" 'd["backup"]["root"]')
inside_root "$BACKUP2" "$ROOT2" && fail "case2 backup inside active root"
[ -f "$BACKUP2/source-0/alpha/plan.md" ] || fail "case2 source backup missing"
[ "$(sha256sum "$BACKUP2/source-0/alpha/plan.md" | cut -d' ' -f1)" = "$ORIG_SHA" ] \
  || fail "case2 backup checksum differs"
[ "$(stat -c %Y "$BACKUP2/source-0/alpha/plan.md")" = "$ORIG_MTIME" ] \
  || fail "case2 backup timestamp changed"
[ -z "$(find "$ROOT2" -maxdepth 1 -name '.migrations' -o -maxdepth 1 -name 'manifest.json')" ] \
  || fail "case2 metadata leaked into active root"
[ ! -e "$CASE/state/work-plans/.migrations/$(basename "$ROOT2")/lock" ] || fail "case2 lock not released"
jtrue "$OUT" 'd["retired_sources"] and len(d["retired_sources"]) == 2' || fail "case2 retire list wrong"
jtrue "$OUT" 'len(d["quarantined_sources"]) == 2 and all(q["verified"] for q in d["quarantined_sources"])' \
  || fail "case2 quarantine verification missing"
jtrue "$OUT" 'd["single_authority"] is True and d["retirement"]["verified"] is True' \
  || fail "case2 single authority not claimed"
jtrue "$OUT" 'all(not q["inside_repository"] for q in d["quarantined_sources"])' \
  || fail "case2 quarantine kept inside the repository"
Q2=$(jget "$OUT" 'd["quarantined_sources"][0]["quarantine"]')
[ -f "$Q2/alpha/plan.md" ] || fail "case2 quarantined original missing"
[ "$(sha256sum "$Q2/alpha/plan.md" | cut -d' ' -f1)" = "$ORIG_SHA" ] \
  || fail "case2 quarantined original changed"
[ ! -e "$CASE/repo/.work-plans-quarantine" ] && [ ! -e "$CASE/linked/.work-plans-quarantine" ] \
  || fail "case2 fallback quarantine created on the same filesystem"
ok "apply merges, rewrites tracking links, preserves evidence, backs up, quarantines"

# --- 3: conflicting plan names across worktrees fail without writes ---------
CASE="$TMP/case03"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
git -C "$CASE/repo" worktree add -q "$CASE/linked" -b linked
add_plan "$CASE/linked/status" alpha
printf '\nconflicting line\n' >> "$CASE/linked/status/alpha/plan.md"
snapshot "$CASE/repo" "$CASE/repo.before"
snapshot "$CASE/linked" "$CASE/linked.before"
OUT="$OUTDIR/case03.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "3" "case3 blocked exit"
assert_eq "$(jget "$OUT" 'd["status"]')" "blocked" "case3 status"
jtrue "$OUT" 'any(c["code"] == "plan_conflict" for c in d["conflicts"])' || fail "case3 conflict not reported"
ROOT3=$(jget "$OUT" 'd["destination"]["root"]')
[ ! -e "$ROOT3" ] || fail "case3 destination created despite conflict"
snapshot "$CASE/repo" "$CASE/repo.after"
snapshot "$CASE/linked" "$CASE/linked.after"
cmp -s "$CASE/repo.before" "$CASE/repo.after" || fail "case3 control source modified"
cmp -s "$CASE/linked.before" "$CASE/linked.after" || fail "case3 linked source modified"
ok "conflicting same plan names blocked, sources untouched"

# --- 4: byte-identical duplicate plan is deduped with explanation -----------
CASE="$TMP/case04"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
git -C "$CASE/repo" worktree add -q "$CASE/linked" -b linked
add_plan "$CASE/linked/status" alpha
OUT="$OUTDIR/case04.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "0" "case4 apply exit"
ROOT4=$(jget "$OUT" 'd["destination"]["root"]')
[ -f "$ROOT4/alpha/plan.md" ] || fail "case4 deduped plan missing"
jtrue "$OUT" 'len(d["plans"]) == 1 and d["plans"][0]["deduped"] and len(d["plans"][0]["sources"]) == 2' \
  || fail "case4 duplicate plan not deduped"
[ ! -e "$ROOT4/alpha/alpha" ] || fail "case4 duplicated plan directory"
ok "identical duplicate plan deduped"

# --- 5: invalid artifacts block activation ----------------------------------
CASE="$TMP/case05"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
printf 'state: PARTIAL\nts: 2026-01-01T00:00:00Z\nmsg: broken\n' > "$CASE/repo/status/alpha/status.md"
OUT="$OUTDIR/case05a.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "3" "case5a invalid plan exit"
jtrue "$OUT" 'any(p["code"] == "invalid_plan" for p in d["invalid_plans"])' \
  || fail "case5a validator failure not reported"
[ ! -e "$(jget "$OUT" 'd["destination"]["root"]')" ] || fail "case5a destination activated"
[ -f "$CASE/repo/status/alpha/status.md" ] || fail "case5a source retired after invalid plan"

CASE="$TMP/case05b"
mkdir -p "$CASE"
new_repo "$CASE/repo"
mkdir -p "$CASE/repo/status/Bad_Name"
write_plan "$CASE/repo/status/Bad_Name" bad
write_status "$CASE/repo/status/Bad_Name" WORKING
printf '2026-01-01 | Bad_Name | WORKING | fixture | status/Bad_Name/plan.md\n' > "$CASE/repo/status/TIMELINE.md"
OUT="$OUTDIR/case05b.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state"
assert_eq "$RC" "0" "case5b dry-run exit"
assert_false "$(jget "$OUT" 'd["would_apply"]')" "case5b would_apply"
jtrue "$OUT" 'any(p["code"] == "invalid_plan_name" for p in d["invalid_plans"])' \
  || fail "case5b invalid plan name not reported"
ok "invalid plans/names block without activation"

# --- 6: unknown loose files and non-plan dirs fail safely -------------------
CASE="$TMP/case06"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
printf 'stray note\n' > "$CASE/repo/status/notes.txt"
mkdir -p "$CASE/repo/status/log"
printf 'entry\n' > "$CASE/repo/status/log/entry.txt"
OUT="$OUTDIR/case06.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state"
assert_eq "$RC" "0" "case6 dry-run exit"
assert_false "$(jget "$OUT" 'd["would_apply"]')" "case6 would_apply"
jtrue "$OUT" 'any(p["code"] == "unknown_entry" for p in d["unknown_entries"])' \
  || fail "case6 loose file not reported"
OUT="$OUTDIR/case06-apply.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "3" "case6 apply exit"
[ ! -e "$(jget "$OUT" 'd["destination"]["root"]')" ] || fail "case6 destination created"
[ -f "$CASE/repo/status/notes.txt" ] || fail "case6 unknown source removed"
ok "unknown loose files and non-plan dirs block apply"

# --- 7: symlinks are rejected, never followed -------------------------------
CASE="$TMP/case07"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
mkdir -p "$CASE/repo/status/alpha/lanes"
printf 'state: WORKING\nts: 2026-01-01T00:00:00Z\nmsg: lane\n' > "$CASE/repo/status/alpha/lanes/lane-a.md"
ln -s ../plan.md "$CASE/repo/status/alpha/lanes/link.md"
OUT="$OUTDIR/case07.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "3" "case7 symlink exit"
jtrue "$OUT" 'any(p["code"] == "source_symlink" for p in d["symlinks"])' || fail "case7 symlink not reported"
[ ! -e "$(jget "$OUT" 'd["destination"]["root"]')" ] || fail "case7 destination created"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case7 symlink target disturbed"
ok "symlinks rejected without following"

# --- 8: tracked status artifacts block apply --------------------------------
CASE="$TMP/case08"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
git -C "$CASE/repo" add -f status/alpha/plan.md
OUT="$OUTDIR/case08.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "3" "case8 tracked exit"
jtrue "$OUT" 'any(p["code"] == "tracked_artifact" for p in d["tracked"])' || fail "case8 tracked artifact not reported"
[ ! -e "$(jget "$OUT" 'd["destination"]["root"]')" ] || fail "case8 destination created"
ok "tracked source artifacts block apply"

# --- 9: a source mutation after staging aborts before activation ------------
CASE="$TMP/case09"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
OUT="$OUTDIR/case09.json"
run_migrate_env "$CASE/repo" "$OUT" "$CASE/state" \
  "WORK_PLANS_MIGRATE_TEST_FAULT=mutate-source-before-activation" --apply --writers-paused
assert_eq "$RC" "4" "case9 source race exit"
assert_eq "$(jget "$OUT" 'd["error"]["code"]')" "source_changed" "case9 error code"
ROOT9=$(jget "$OUT" 'd["destination"]["root"]')
[ ! -e "$ROOT9" ] || fail "case9 destination activated despite source race"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case9 source lost after race"
MANIFEST9=$(jget "$OUT" 'd["manifest"]["path"]')
[ -f "$MANIFEST9" ] || fail "case9 manifest missing"
jtrue "$MANIFEST9" 'd["state"] == "failed"' || fail "case9 manifest not failed"
ok "source mutation during migration aborts before activation"

# --- 10: interrupted apply before activation leaves originals authoritative -
CASE="$TMP/case10"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
OUT="$OUTDIR/case10.json"
run_migrate_env "$CASE/repo" "$OUT" "$CASE/state" \
  "WORK_PLANS_MIGRATE_TEST_FAULT=fail-before-activation" --apply --writers-paused
assert_eq "$RC" "5" "case10 interrupted exit"
assert_eq "$(jget "$OUT" 'd["error"]["code"]')" "simulated_fault" "case10 error code"
[ ! -e "$(jget "$OUT" 'd["destination"]["root"]')" ] || fail "case10 destination activated"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case10 source removed on interruption"
BACKUP10=$(jget "$OUT" 'd["backup"]["root"]')
[ -f "$BACKUP10/source-0/alpha/plan.md" ] || fail "case10 backup missing"
MANIFEST10=$(jget "$OUT" 'd["manifest"]["path"]')
jtrue "$MANIFEST10" 'd["state"] == "failed"' || fail "case10 manifest not failed"
ok "interruption before activation keeps originals authoritative"

# --- 11a: existing external store is combined without overwrite -------------
CASE="$TMP/case11a"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
ROOT11=$(resolved_root "$CASE/repo" "$CASE/state")
mkdir -p "$ROOT11/gamma"
write_plan "$ROOT11/gamma" gamma
write_status "$ROOT11/gamma" DONE
write_report "$ROOT11/gamma" gamma
printf '2026-01-04 | gamma | DONE | pre-existing store | status/gamma/report.md\n' > "$ROOT11/TIMELINE.md"
GAMMA_SHA=$(sha256sum "$ROOT11/gamma/plan.md" | cut -d' ' -f1)
OUT="$OUTDIR/case11a.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "0" "case11a apply exit"
ROOT11B=$(jget "$OUT" 'd["destination"]["root"]')
[ "$ROOT11B" = "$ROOT11" ] || fail "case11a destination changed"
[ -f "$ROOT11/alpha/plan.md" ] || fail "case11a new plan missing"
[ -f "$ROOT11/gamma/plan.md" ] || fail "case11a existing plan lost"
[ "$(sha256sum "$ROOT11/gamma/plan.md" | cut -d' ' -f1)" = "$GAMMA_SHA" ] \
  || fail "case11a existing plan overwritten"
grep -Fq 'gamma/report.md' "$ROOT11/TIMELINE.md" || fail "case11a existing timeline link not rewritten"
jtrue "$OUT" 'd["activation"]["method"] == "replace-existing"' || fail "case11a not a swap activation"
jtrue "$OUT" 'd["existing_destination"] is not None' || fail "case11a existing destination not reported"
PREV11=$(jget "$OUT" 'd["activation"]["previous_root"]')
[ -n "$PREV11" ] && [ -f "$PREV11/gamma/plan.md" ] || fail "case11a previous store not retained"
jtrue "$OUT" 'any(s["kind"] == "destination" for s in d["backup"]["stores"])' \
  || fail "case11a existing destination not backed up"
ok "existing external store combined, swapped, and retained without overwrite"

# --- 11b: conflicting existing destination is never overwritten -------------
CASE="$TMP/case11b"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
ROOT11C=$(resolved_root "$CASE/repo" "$CASE/state")
mkdir -p "$ROOT11C/alpha"
write_plan "$ROOT11C/alpha" alpha
printf '\nexisting destination version\n' >> "$ROOT11C/alpha/plan.md"
write_status "$ROOT11C/alpha" WORKING
printf '2026-01-06 | alpha | WORKING | existing | alpha/plan.md\n' > "$ROOT11C/TIMELINE.md"
snapshot "$ROOT11C" "$CASE/existing.before"
OUT="$OUTDIR/case11b.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "3" "case11b conflict exit"
jtrue "$OUT" 'any(c["code"] == "existing_destination_conflict" for c in d["conflicts"])' \
  || fail "case11b existing destination conflict not reported"
snapshot "$ROOT11C" "$CASE/existing.after"
cmp -s "$CASE/existing.before" "$CASE/existing.after" || fail "case11b existing destination modified"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case11b source retired after conflict"
ok "existing destination conflict fails without overwrite"

# --- 12: destination lock conflicts fail closed -----------------------------
CASE="$TMP/case12"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
ROOT12=$(resolved_root "$CASE/repo" "$CASE/state")
LOCK12="$CASE/state/work-plans/.migrations/$(basename "$ROOT12")/lock"
mkdir -p "$(dirname "$LOCK12")"
printf 'pid=999\n' > "$LOCK12"
OUT="$OUTDIR/case12.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "4" "case12 lock exit"
assert_eq "$(jget "$OUT" 'd["error"]["code"]')" "destination_locked" "case12 error code"
[ ! -e "$ROOT12" ] || fail "case12 destination created under lock conflict"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case12 source removed under lock conflict"
[ -f "$LOCK12" ] || fail "case12 foreign lock removed"
ok "destination lock conflict fails closed"

# --- 13: apply requires the writers-paused acknowledgment -------------------
CASE="$TMP/case13"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
OUT="$OUTDIR/case13.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply
assert_eq "$RC" "2" "case13 missing acknowledgment exit"
assert_eq "$(jget "$OUT" 'd["error"]["code"]')" "writers_not_paused" "case13 error code"
[ ! -e "$CASE/state" ] || fail "case13 state written without acknowledgment"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case13 source removed"
ok "apply refuses to run without --writers-paused"

# --- 14: non-Git invocation fails clearly -----------------------------------
CASE="$TMP/case14"
mkdir -p "$CASE/plain"
OUT="$OUTDIR/case14.json"
run_migrate "$CASE/plain" "$OUT" "$CASE/state"
assert_eq "$RC" "2" "case14 outside-git exit"
assert_eq "$(jget "$OUT" 'd["error"]["code"]')" "outside_git" "case14 error code"
[ ! -e "$CASE/state" ] || fail "case14 state written outside git"
ok "non-Git invocation fails clearly"

# --- 15: explicit --source still accounts for every legacy root -------------
CASE="$TMP/case15"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
git -C "$CASE/repo" worktree add -q "$CASE/linked" -b linked
add_plan "$CASE/linked/status" beta
OUT="$OUTDIR/case15-dry.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --source "$CASE/repo/status"
assert_eq "$RC" "0" "case15 dry-run exit"
assert_false "$(jget "$OUT" 'd["would_apply"]')" "case15 omitted nonempty root must block"
jtrue "$OUT" 'len(d["omitted_sources"]) == 1 and d["omitted_sources"][0]["nonempty"] and d["omitted_sources"][0]["path"].endswith("/linked/status")' \
  || fail "case15 omitted root not reported by dry-run"
jtrue "$OUT" 'any(p["code"] == "source_omitted" for p in d["blockers"])' \
  || fail "case15 omitted root blocker missing"
ROOT15=$(jget "$OUT" 'd["destination"]["root"]')
[ ! -e "$ROOT15" ] || fail "case15 dry-run created destination"
[ ! -e "$CASE/state/work-plans/.migrations" ] || fail "case15 dry-run wrote metadata"
OUT="$OUTDIR/case15-blocked.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused --source "$CASE/repo/status"
assert_eq "$RC" "3" "case15 omitted source apply exit"
assert_eq "$(jget "$OUT" 'd["status"]')" "blocked" "case15 omitted source status"
jtrue "$OUT" 'any(p["code"] == "source_omitted" for p in d["blockers"])' \
  || fail "case15 apply omitted root blocker missing"
[ ! -e "$ROOT15" ] || fail "case15 destination created despite omitted root"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case15 included source disturbed"
[ -f "$CASE/linked/status/beta/plan.md" ] || fail "case15 omitted source disturbed"
[ ! -e "$CASE/repo/.work-plans-quarantine" ] && [ ! -e "$CASE/linked/.work-plans-quarantine" ] \
  || fail "case15 quarantine created on a blocked run"
OUT="$OUTDIR/case15-all.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused \
  --source "$CASE/repo/status" --source "$CASE/linked/status"
assert_eq "$RC" "0" "case15 all-sources apply exit"
assert_eq "$(jget "$OUT" 'len(d["sources"])')" "2" "case15 source count"
assert_eq "$(jget "$OUT" 'len(d["omitted_sources"])')" "0" "case15 omitted source count"
[ -f "$ROOT15/alpha/plan.md" ] || fail "case15 explicit plan missing"
[ -f "$ROOT15/beta/plan.md" ] || fail "case15 second explicit plan missing"
[ ! -e "$CASE/repo/status" ] || fail "case15 explicit source not quarantined"
[ ! -e "$CASE/linked/status" ] || fail "case15 second explicit source not quarantined"
OUT="$OUTDIR/case15-relative.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state2" --source status
assert_eq "$RC" "2" "case15 relative-source exit"
assert_eq "$(jget "$OUT" 'd["error"]["code"]')" "source_not_absolute" "case15 relative-source code"
ok "explicit --source still inventories every legacy root"

# --- 16: archive migration validates with --root and preserves chronology ---
CASE="$TMP/case16"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_archive_plan "$CASE/repo/status" "2026-01-02-old" old DONE
OUT="$OUTDIR/case16.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "0" "case16 archive apply exit"
ROOT16=$(jget "$OUT" 'd["destination"]["root"]')
[ -f "$ROOT16/archive/2026-01-02-old/plan.md" ] || fail "case16 archive plan missing"
[ -f "$ROOT16/archive/2026-01-02-old/report.md" ] || fail "case16 archive report missing"
jtrue "$OUT" 'len(d["validation"]["archives"]) == 1 and d["validation"]["archives"][0]["ok"]' \
  || fail "case16 archive not validated"
jtrue "$OUT" 'd["validation"]["archives"][0]["timeline_exempt"]' \
  || fail "case16 archive TIMELINE exemption not recorded"
grep -Fq 'archive/2026-01-02-old/plan.md' "$ROOT16/TIMELINE.md" \
  || fail "case16 archive timeline link not rewritten"
ok "archive migration validated and chronology preserved"

# --- 17: dry-run against an existing destination writes nothing ------------
CASE="$TMP/case17"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
ROOT17=$(resolved_root "$CASE/repo" "$CASE/state")
mkdir -p "$ROOT17/gamma"
write_plan "$ROOT17/gamma" gamma
write_status "$ROOT17/gamma" WORKING
printf '2026-01-04 | gamma | WORKING | pre-existing | gamma/plan.md\n' > "$ROOT17/TIMELINE.md"
snapshot "$ROOT17" "$CASE/existing.before"
OUT="$OUTDIR/case17.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state"
assert_eq "$RC" "0" "case17 dry-run exit"
assert_true "$(jget "$OUT" 'd["destination"]["exists"]')" "case17 destination exists"
assert_true "$(jget "$OUT" 'd["destination"]["combined"]')" "case17 destination combined"
assert_true "$(jget "$OUT" 'd["would_apply"]')" "case17 would_apply"
snapshot "$ROOT17" "$CASE/existing.after"
cmp -s "$CASE/existing.before" "$CASE/existing.after" || fail "case17 dry-run modified existing destination"
ok "dry-run leaves an existing destination byte-identical"

# --- 18: spaces in repository, worktree, and XDG paths ---------------------
CASE="$TMP/case18"
mkdir -p "$CASE"
new_repo "$CASE/repo with space"
add_plan "$CASE/repo with space/status" alpha
git -C "$CASE/repo with space" worktree add -q "$CASE/linked with space" -b linked
add_plan "$CASE/linked with space/status" beta
OUT="$OUTDIR/case18.json"
run_migrate "$CASE/repo with space" "$OUT" "$CASE/state with space" --apply --writers-paused
assert_eq "$RC" "0" "case18 spaces apply exit"
ROOT18=$(jget "$OUT" 'd["destination"]["root"]')
inside_root "$ROOT18" "$CASE/state with space/work-plans" || fail "case18 destination path wrong"
[ -f "$ROOT18/alpha/plan.md" ] && [ -f "$ROOT18/beta/plan.md" ] || fail "case18 plans missing"
[ ! -e "$CASE/repo with space/status" ] || fail "case18 control source not retired"
[ ! -e "$CASE/linked with space/status" ] || fail "case18 linked source not retired"
ok "spaces in repo/worktree/XDG paths migrate correctly"

# --- 19: activation failure restores the previous destination --------------
CASE="$TMP/case19"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
ROOT19=$(resolved_root "$CASE/repo" "$CASE/state")
mkdir -p "$ROOT19/gamma"
write_plan "$ROOT19/gamma" gamma
write_status "$ROOT19/gamma" WORKING
printf '2026-01-04 | gamma | WORKING | pre-existing | gamma/plan.md\n' > "$ROOT19/TIMELINE.md"
GAMMA19=$(sha256sum "$ROOT19/gamma/plan.md" | cut -d' ' -f1)
OUT="$OUTDIR/case19.json"
run_migrate_env "$CASE/repo" "$OUT" "$CASE/state" \
  "WORK_PLANS_MIGRATE_TEST_FAULT=fail-after-retire-existing" --apply --writers-paused
assert_eq "$RC" "5" "case19 activation rollback exit"
assert_eq "$(jget "$OUT" 'd["error"]["code"]')" "simulated_fault" "case19 error code"
[ -d "$ROOT19" ] || fail "case19 previous destination not restored"
[ -f "$ROOT19/gamma/plan.md" ] || fail "case19 previous destination content lost"
[ "$(sha256sum "$ROOT19/gamma/plan.md" | cut -d' ' -f1)" = "$GAMMA19" ] \
  || fail "case19 previous destination mutated"
[ ! -e "$ROOT19/alpha" ] || fail "case19 failed activation left new store active"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case19 source retired on failed activation"
MANIFEST19=$(jget "$OUT" 'd["manifest"]["path"]')
jtrue "$MANIFEST19" 'd["state"] == "failed"' || fail "case19 manifest not failed"
ok "activation failure restores the previous destination, originals intact"

# --- 20: option-shaped plan names cannot bypass validation -----------------
CASE="$TMP/case20"
mkdir -p "$CASE"
new_repo "$CASE/repo"
for name in --help -h; do
  mkdir -p "$CASE/repo/status/$name"
  write_plan "$CASE/repo/status/$name" "$name"
  write_status "$CASE/repo/status/$name" PARTIAL
  timeline_add "$CASE/repo/status" 2026-01-01 "$name" PARTIAL
done
OUT="$OUTDIR/case20.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "3" "case20 option-shaped plan exit"
jtrue "$OUT" 'd["validation"]["performed"] and len(d["validation"]["plans"]) == 2 and all(p["exit"] != 0 for p in d["validation"]["plans"])' \
  || fail "case20 option-shaped plan name bypassed validation"
jtrue "$OUT" 'any(p["code"] == "invalid_plan" for p in d["invalid_plans"])' \
  || fail "case20 validator failure not reported"
[ ! -e "$(jget "$OUT" 'd["destination"]["root"]')" ] || fail "case20 destination activated"
[ -f "$CASE/repo/status/--help/plan.md" ] && [ -f "$CASE/repo/status/-h/plan.md" ] \
  || fail "case20 option-shaped sources disturbed"
ok "option-shaped plan names cannot bypass staged validation"

# --- 21a: symlinked .migrations blocks before any write ---------------------
CASE="$TMP/case21a"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
mkdir -p "$CASE/state/work-plans" "$CASE/elsewhere"
ROOT21A=$(resolved_root "$CASE/repo" "$CASE/state")
ln -s "$CASE/elsewhere" "$CASE/state/work-plans/.migrations"
OUT="$OUTDIR/case21a.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "3" "case21a metadata symlink exit"
jtrue "$OUT" 'any(p["code"] == "metadata_path_symlink" for p in d["symlinks"])' \
  || fail "case21a .migrations symlink not reported"
[ -z "$(ls -A "$CASE/elsewhere")" ] || fail "case21a wrote through the .migrations symlink"
[ ! -e "$ROOT21A" ] || fail "case21a destination created"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case21a source disturbed"
ok "symlinked .migrations directory rejected before writes"

# --- 21b: symlinked .locks blocks before any write -------------------------
CASE="$TMP/case21b"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
mkdir -p "$CASE/state/work-plans" "$CASE/elsewhere"
ROOT21B=$(resolved_root "$CASE/repo" "$CASE/state")
ln -s "$CASE/elsewhere" "$CASE/state/work-plans/.locks"
OUT="$OUTDIR/case21b.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
assert_eq "$RC" "3" "case21b timeline lock symlink exit"
jtrue "$OUT" 'any(p["code"] == "metadata_path_symlink" for p in d["symlinks"])' \
  || fail "case21b .locks symlink not reported"
[ -z "$(ls -A "$CASE/elsewhere")" ] || fail "case21b wrote through the .locks symlink"
[ ! -e "$ROOT21B" ] || fail "case21b destination created"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case21b source disturbed"
ok "symlinked .locks directory rejected before writes"

# --- 22: destination mutated after inventory is rechecked before swap ------
CASE="$TMP/case22"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
ROOT22=$(resolved_root "$CASE/repo" "$CASE/state")
mkdir -p "$ROOT22/gamma"
write_plan "$ROOT22/gamma" gamma
write_status "$ROOT22/gamma" WORKING
printf '2026-01-04 | gamma | WORKING | pre-existing | gamma/plan.md\n' > "$ROOT22/TIMELINE.md"
GAMMA22=$(sha256sum "$ROOT22/gamma/plan.md" | cut -d' ' -f1)
OUT="$OUTDIR/case22.json"
run_migrate_env "$CASE/repo" "$OUT" "$CASE/state" \
  "WORK_PLANS_MIGRATE_TEST_FAULT=mutate-destination-before-activation" --apply --writers-paused
assert_eq "$RC" "4" "case22 destination recheck exit"
assert_eq "$(jget "$OUT" 'd["error"]["code"]')" "destination_changed" "case22 error code"
grep -Fq 'simulated late writer' "$ROOT22/TIMELINE.md" \
  || fail "case22 late destination write was lost"
[ "$(sha256sum "$ROOT22/gamma/plan.md" | cut -d' ' -f1)" = "$GAMMA22" ] \
  || fail "case22 existing destination plan mutated"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case22 source disturbed"
[ -z "$(find "$CASE/state/work-plans/.migrations" -name previous-root 2>/dev/null)" ] \
  || fail "case22 destination swapped despite the race"
MANIFEST22=$(jget "$OUT" 'd["manifest"]["path"]')
jtrue "$MANIFEST22" 'd["state"] == "failed"' || fail "case22 manifest not failed"
ok "late destination mutation blocks the swap and preserves both sides"

# --- 23: destination created after an absent-root inventory is preserved ---
CASE="$TMP/case23"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
ROOT23=$(resolved_root "$CASE/repo" "$CASE/state")
OUT="$OUTDIR/case23.json"
run_migrate_env "$CASE/repo" "$OUT" "$CASE/state" \
  "WORK_PLANS_MIGRATE_TEST_FAULT=create-destination-before-activation" --apply --writers-paused
assert_eq "$RC" "4" "case23 late destination exit"
assert_eq "$(jget "$OUT" 'd["error"]["code"]')" "destination_changed" "case23 error code"
[ -f "$ROOT23/late-writer.md" ] || fail "case23 late-created destination destroyed"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case23 source disturbed"
MANIFEST23=$(jget "$OUT" 'd["manifest"]["path"]')
jtrue "$MANIFEST23" 'd["state"] == "failed"' || fail "case23 manifest not failed"
ok "destination created after inventory is reported, never replaced"

# --- 24: writer racing past the re-check is retained in quarantine ---------
CASE="$TMP/case24"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
OUT="$OUTDIR/case24.json"
run_migrate_env "$CASE/repo" "$OUT" "$CASE/state" \
  "WORK_PLANS_MIGRATE_TEST_FAULT=mutate-source-after-recheck" --apply --writers-paused
assert_eq "$RC" "4" "case24 quarantine race exit"
assert_eq "$(jget "$OUT" 'd["error"]["code"]')" "quarantine_verify_failed" "case24 error code"
Q24=$(jget "$OUT" 'd["quarantined_sources"][0]["quarantine"]')
[ -f "$Q24/alpha/plan.md" ] || fail "case24 quarantined original missing"
grep -Fq 'simulated late writer mutation' "$Q24/alpha/plan.md" \
  || fail "case24 late write not retained in quarantine"
jtrue "$OUT" 'd["quarantined_sources"][0]["verified"] is False and d["single_authority"] is False' \
  || fail "case24 race not reported conservatively"
[ ! -e "$CASE/repo/status" ] || fail "case24 original not quarantined"
MANIFEST24=$(jget "$OUT" 'd["manifest"]["path"]')
jtrue "$MANIFEST24" 'd["state"] == "activated-unretired" and d["single_authority"] is False' \
  || fail "case24 manifest did not record the unretired authority split"
jtrue "$MANIFEST24" 'd["retirement"]["recovery"]' || fail "case24 recovery mapping missing"
ok "late source write is detected in quarantine, never deleted"

# --- 25: source recreated after quarantine is preserved and reported -------
CASE="$TMP/case25"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
OUT="$OUTDIR/case25.json"
run_migrate_env "$CASE/repo" "$OUT" "$CASE/state" \
  "WORK_PLANS_MIGRATE_TEST_FAULT=recreate-source-after-quarantine" --apply --writers-paused
assert_eq "$RC" "4" "case25 recreated source exit"
assert_eq "$(jget "$OUT" 'd["error"]["code"]')" "source_recreated" "case25 error code"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case25 recreated source removed"
grep -Fq 'recreated' "$CASE/repo/status/alpha/plan.md" || fail "case25 recreated source overwritten"
Q25=$(jget "$OUT" 'd["quarantined_sources"][0]["quarantine"]')
grep -Fq '# Plan: alpha' "$Q25/alpha/plan.md" || fail "case25 quarantined original lost"
jtrue "$OUT" 'd["quarantined_sources"][0]["recreated"] is True and d["single_authority"] is False' \
  || fail "case25 recreation not reported"
MANIFEST25=$(jget "$OUT" 'd["manifest"]["path"]')
jtrue "$MANIFEST25" 'd["state"] == "activated-unretired"' || fail "case25 manifest state wrong"
ok "recreated source is preserved and single authority is not claimed"

# --- 26: an empty omitted legacy root does not block explicit sources ------
CASE="$TMP/case26"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
git -C "$CASE/repo" worktree add -q "$CASE/linked" -b linked
mkdir -p "$CASE/linked/status"
OUT="$OUTDIR/case26.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused --source "$CASE/repo/status"
assert_eq "$RC" "0" "case26 empty omitted root exit"
jtrue "$OUT" 'len(d["omitted_sources"]) == 1 and d["omitted_sources"][0]["nonempty"] is False' \
  || fail "case26 empty omitted root not reported"
ROOT26=$(jget "$OUT" 'd["destination"]["root"]')
[ -f "$ROOT26/alpha/plan.md" ] || fail "case26 plan missing"
[ ! -e "$CASE/repo/status" ] || fail "case26 selected source not quarantined"
[ -d "$CASE/linked/status" ] || fail "case26 empty legacy root removed"
[ -z "$(ls -A "$CASE/linked/status")" ] || fail "case26 empty legacy root changed"
ok "empty omitted legacy root is reported but does not block"

# --- 27: cross-filesystem source quarantined outside every checkout --------
CASE="$TMP/case27"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
if [ -d /dev/shm ] && [ -w /dev/shm ] \
  && [ "$(stat -c %d /dev/shm)" != "$(stat -c %d "$TMP")" ]; then
  ALT=$(mktemp -d /dev/shm/work-plans-selftest.XXXXXX) || fail "case27 cannot create alt state dir"
  OUT="$OUTDIR/case27.json"
  run_migrate "$CASE/repo" "$OUT" "$ALT" --apply --writers-paused
  assert_eq "$RC" "0" "case27 cross-filesystem apply exit"
  Q27=$(jget "$OUT" 'd["quarantined_sources"][0]["quarantine"]')
  inside_root "$Q27" "$CASE/.work-plans-quarantine" \
    || fail "case27 quarantine not outside the checkout on the source filesystem: $Q27"
  jtrue "$OUT" 'd["quarantined_sources"][0]["inside_repository"] is False' \
    || fail "case27 quarantine reported inside the repository"
  grep -Fq '# Plan: alpha' "$Q27/alpha/plan.md" || fail "case27 quarantined original missing"
  [ ! -e "$CASE/repo/status" ] || fail "case27 source not quarantined"
  [ ! -e "$CASE/repo/.work-plans-quarantine" ] || fail "case27 quarantine left inside the repository"
  ok "cross-filesystem source quarantined outside every checkout"
else
  echo "skip - cross-filesystem quarantine needs a distinct writable filesystem"
fi

# --- 28: hashed root aliased to another store is rejected ------------------
CASE="$TMP/case28"
mkdir -p "$CASE"
new_repo "$CASE/repo"
add_plan "$CASE/repo/status" alpha
new_repo "$CASE/other"
add_plan "$CASE/other/status" beta
OTHER_ROOT=$(resolved_root "$CASE/other" "$CASE/state")
[ -n "$OTHER_ROOT" ] || fail "case28 could not resolve the other repo's root"
mkdir -p "$OTHER_ROOT/gamma"
write_plan "$OTHER_ROOT/gamma" gamma
write_status "$OTHER_ROOT/gamma" WORKING
printf '2026-01-04 | gamma | WORKING | other store | gamma/plan.md\n' > "$OTHER_ROOT/TIMELINE.md"
GAMMA28=$(sha256sum "$OTHER_ROOT/gamma/plan.md" | cut -d' ' -f1)
MINE=$(resolved_root "$CASE/repo" "$CASE/state")
[ -n "$MINE" ] || fail "case28 could not resolve the repo's own root"
mkdir -p "$(dirname "$MINE")"
ln -s "$OTHER_ROOT" "$MINE"
snapshot "$CASE/state" "$CASE/state.before"
snapshot "$CASE/repo/status" "$CASE/repo-status.before"
snapshot "$CASE/other/status" "$CASE/other-status.before"
OUT="$OUTDIR/case28.json"
run_migrate "$CASE/repo" "$OUT" "$CASE/state" --apply --writers-paused
[ "$RC" -ne 0 ] || fail "case28 aliased root was accepted"
jtrue "$OUT" 'd["error"] is not None and d["error"]["code"] in ("resolver_failed", "outside_git", "destination_symlink", "metadata_path_symlink")' \
  || fail "case28 aliased root rejection not reported"
snapshot "$CASE/state" "$CASE/state.after"
cmp -s "$CASE/state.before" "$CASE/state.after" || fail "case28 external stores modified"
snapshot "$CASE/repo/status" "$CASE/repo-status.after"
cmp -s "$CASE/repo-status.before" "$CASE/repo-status.after" || fail "case28 source store modified"
snapshot "$CASE/other/status" "$CASE/other-status.after"
cmp -s "$CASE/other-status.before" "$CASE/other-status.after" || fail "case28 other source store modified"
[ "$(sha256sum "$OTHER_ROOT/gamma/plan.md" | cut -d' ' -f1)" = "$GAMMA28" ] \
  || fail "case28 other store overwritten"
[ -L "$MINE" ] || fail "case28 aliased root replaced"
[ -f "$CASE/repo/status/alpha/plan.md" ] || fail "case28 source plan removed"
[ -f "$CASE/other/status/beta/plan.md" ] || fail "case28 other source plan removed"
[ ! -e "$CASE/repo/.work-plans-quarantine" ] && [ ! -e "$CASE/other/.work-plans-quarantine" ] \
  || fail "case28 quarantine created on a rejected run"
ok "hashed root aliased to another store is rejected, both stores untouched"

echo
echo "all $PASS checks passed"
exit 0
