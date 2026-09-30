#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
[ -d status ] || { echo "plan-check: status/ not found under $ROOT (run inside the project repo)"; exit 2; }

fail=0
ok() { printf "  ok: %s\n" "$*"; }
bad() { printf "  fail: %s\n" "$*"; fail=1; }

PLAN="${1:-}"
if [ -z "$PLAN" ]; then
  echo "usage: plan-check.sh <plan>"
  exit 2
fi
case "$PLAN" in
  *[!a-z0-9-]*) echo "plan-check: invalid plan name '$PLAN' (want [a-z0-9-])" >&2; exit 2 ;;
esac

DIR="status/$PLAN"
[ -f "$DIR/plan.md" ] || { bad "$DIR/plan.md missing"; }
[ -f "$DIR/status.md" ] || { bad "$DIR/status.md missing"; }

if [ -f "$DIR/plan.md" ]; then
  grep -qE "Out|Non-scope" "$DIR/plan.md" && ok "plan.md has scope Out" || bad "plan.md without scope Out/Non-scope (legacy SPEC docs stay RED by design)"
fi

# Atomic crumbs (## Tasks) — evaluated ONLY when the plan declares tasks; legacy plans unchanged.
if [ -f "$DIR/plan.md" ] && grep -qE '^## Tasks' "$DIR/plan.md"; then
  if grep -qE '^## Acceptance' "$DIR/plan.md"; then
    ok "plan.md has Acceptance section"
    MISSING="$(awk '
      /^## Acceptance/ { s=1; next }
      s && /^## / { s=0 }
      s && $0 ~ /[^[:space:]]/ && $0 !~ /verify:/ { print }
    ' "$DIR/plan.md")"
    if [ -z "$MISSING" ]; then
      ok "every Acceptance line carries verify:"
    else
      bad "Acceptance line without verify: ${MISSING%%$'\n'*}"
    fi
  else
    bad "Tasks declared but no ## Acceptance section"
  fi

  while IFS=$'\t' read -r kind msg; do
    [ -z "$kind" ] && continue
    if [ "$kind" = "OK" ]; then ok "$msg"; else bad "$msg"; fi
  done < <(awk '
    function trim(s) { sub(/^[[:space:]]+/, "", s); sub(/[[:space:]]+$/, "", s); return s }
    function isnone(s) { return s == "" || s == "—" || s == "-" }
    function inlist_space(list, id,   a, i) {
      if (list == "") return 0
      n = split(list, a, " ")
      for (i = 1; i <= n; i++) if (a[i] == id) return 1
      return 0
    }
    function inlist_csv(list, id,   a, i, t) {
      if (isnone(list)) return 0
      n = split(list, a, ",")
      for (i = 1; i <= n; i++) { t = trim(a[i]); if (t == id) return 1 }
      return 0
    }
    function shared(a, b, sep,   na, nb, ia, ib, ta, tb, x, y) {
      if (isnone(a) || isnone(b)) return ""
      na = split(a, ia, sep); nb = split(b, ib, sep)
      for (x = 1; x <= na; x++) { ta = trim(ia[x]); if (ta == "") continue
        for (y = 1; y <= nb; y++) { tb = trim(ib[y]); if (ta == tb) return ta } }
      return ""
    }
    BEGIN { inT = 0; lane = ""; nrows = 0; nlanes = 0; structerr = 0; disjerr = 0 }
    /^## Tasks/ { inT = 1; next }
    inT && /^## / { inT = 0 }
    inT && /^###/ { lane = trim(substr($0, 4)); next }
    inT && /^[[:space:]]*\|/ {
      n = split($0, f, "|")
      if (n < 8 || n > 9) { printf "BAD\tTasks: malformed row (want 7 columns): %s\n", trim($0); structerr++; next }
      id = trim(f[2]); owner = trim(f[3]); files = trim(f[4])
      res = trim(f[5]); acc = trim(f[6]); gate = trim(f[7]); edges = trim(f[8])
      if (id ~ /^[-: ]+$/ || tolower(id) == "id") next
      if (id == "") { printf "BAD\tTasks: row without id\n"; structerr++; next }
      if (lane == "") { printf "BAD\tTasks: row %s not under a ### lane heading\n", id; structerr++; next }
      nrows++
      if (!(lane in lane_seen)) { lane_seen[lane] = 1; nlanes++; laneorder[nlanes] = lane }
      key = lane SUBSEP id
      if (id !~ /^T[0-9]+$/) { printf "BAD\tTasks: lane %s invalid id %s\n", lane, id; structerr++ }
      if (key in seenid) { printf "BAD\tTasks: lane %s duplicate id %s\n", lane, id; structerr++ }
      seenid[key] = 1
      ids[lane] = ids[lane] " " id
      FILES[key] = files; RES[key] = res; EDGES[key] = edges
      if (owner == "") { printf "BAD\tTasks: lane %s %s missing owner\n", lane, id; structerr++ }
      if (files == "") { printf "BAD\tTasks: lane %s %s missing files\n", lane, id; structerr++ }
      else {
        nfc = split(files, fca, ",")
        for (fci = 1; fci <= nfc; fci++) {
          if (isnone(trim(fca[fci]))) {
            printf "BAD\tTasks: lane %s %s files placeholder \"%s\" — list comma-separated real paths\n", lane, id, trim(fca[fci])
            structerr++
            break
          }
        }
      }
      if (res == "") { printf "BAD\tTasks: lane %s %s missing resources\n", lane, id; structerr++ }
      if (acc == "") { printf "BAD\tTasks: lane %s %s missing acceptance\n", lane, id; structerr++ }
      if (gate == "") { printf "BAD\tTasks: lane %s %s missing gate\n", lane, id; structerr++ }
      else gatecount[lane]++
    }
    END {
      if (nrows == 0) { printf "BAD\tTasks: section present with no crumb rows\n"; structerr++ }
      for (li = 1; li <= nlanes; li++) {
        l = laneorder[li]
        if (gatecount[l] + 0 == 0) { printf "BAD\tTasks: lane %s has tasks but no gate row\n", l; structerr++ }
      }
      if (structerr == 0) {
        printf "OK\tTasks: %d crumbs in %d lane(s) well-formed\n", nrows, nlanes
        for (li = 1; li <= nlanes; li++) {
          l = laneorder[li]
          m = split(ids[l], arr, " ")
          for (i = 1; i <= m; i++) {
            id = arr[i]; e = EDGES[l SUBSEP id]
            if (isnone(e)) continue
            ne = split(e, ea, ",")
            for (j = 1; j <= ne; j++) {
              t = trim(ea[j]); if (t == "") continue
              if (!inlist_space(ids[l], t)) { printf "BAD\tTasks: lane %s %s edge %s not found\n", l, id, t; disjerr++ }
            }
          }
        }
        if (disjerr == 0) printf "OK\tTasks: edges reference existing ids\n"
        for (li = 1; li <= nlanes; li++) {
          l = laneorder[li]
          m = split(ids[l], arr, " ")
          for (i = 1; i <= m; i++) for (j = i + 1; j <= m; j++) {
            a = arr[i]; b = arr[j]
            if (inlist_csv(EDGES[l SUBSEP a], b) || inlist_csv(EDGES[l SUBSEP b], a)) continue
            s = shared(FILES[l SUBSEP a], FILES[l SUBSEP b], ",")
            if (s != "") { printf "BAD\tTasks: lane %s %s and %s share file %s without an edge\n", l, a, b, s; disjerr++; continue }
            s = shared(RES[l SUBSEP a], RES[l SUBSEP b], "[ ,]+")
            if (s != "") { printf "BAD\tTasks: lane %s %s and %s share resource %s without an edge\n", l, a, b, s; disjerr++ }
          }
        }
        if (disjerr == 0) printf "OK\tTasks: crumbs in a lane are file/resource-disjoint\n"
      }
    }
  ' "$DIR/plan.md")
fi

if [ -f "$DIR/status.md" ]; then
  LINES="$(awk 'END{print NR}' "$DIR/status.md")"
  [ "$LINES" -eq 3 ] && ok "status.md is 3 lines" || bad "status.md is $LINES lines, want 3"
  for key in state ts msg; do
    grep -q "^$key:" "$DIR/status.md" && ok "status.md has $key" || bad "status.md missing $key"
  done
  STATE="$(sed -n 's/^state:[[:space:]]*//p' "$DIR/status.md" | head -1 | tr -d '\r' | sed 's/[[:space:]]*$//')"
  case "$STATE" in
    PLAN|WAIT|WORKING|DONE|FAILED) ok "status.md state valid: $STATE" ;;
    "") bad "status.md has no state value" ;;
    *) bad "status.md state '$STATE' not in PLAN|WAIT|WORKING|DONE|FAILED" ;;
  esac
  if [ "$STATE" = "DONE" ] || [ "$STATE" = "FAILED" ]; then
    [ -f "$DIR/report.md" ] && ok "$STATE has report.md" || bad "$STATE without report.md"
  fi
fi

LOOSE="$(find status -maxdepth 1 -type f ! -name TIMELINE.md -print || true)"
if [ -z "$LOOSE" ]; then
  ok "no loose files in status/"
else
  bad "loose files in status/: $LOOSE"
fi

grep -q "| $PLAN |" status/TIMELINE.md 2>/dev/null \
  && ok "TIMELINE has $PLAN" || bad "TIMELINE missing $PLAN"

if [ -d "$DIR/lanes" ]; then
  shopt -s nullglob
  LANES=("$DIR"/lanes/*.md)
  shopt -u nullglob
  if [ ${#LANES[@]} -eq 0 ]; then
    ok "lanes dir empty (none dispatched yet)"
  else
    for lane in "${LANES[@]}"; do
      LINES="$(awk 'END{print NR}' "$lane")"
      [ "$LINES" -eq 3 ] && ok "lane $(basename "$lane") is 3 lines" || bad "lane $(basename "$lane") is $LINES lines, want 3"
    done
  fi
else
  ok "no lanes dir (single-track)"
fi

if [ $fail -eq 0 ]; then
  echo "plan-check GREEN for $PLAN"
else
  echo "plan-check RED for $PLAN"
  exit 1
fi
