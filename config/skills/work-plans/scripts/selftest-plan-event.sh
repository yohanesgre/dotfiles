#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home" XDG_STATE_HOME="$TMP/state"
mkdir -p "$HOME" "$TMP/repo"
git -C "$TMP/repo" init -q
cd "$TMP/repo"
ROOT="$(bash "$SCRIPT_DIR/plan-root.sh")"
mkdir -p "$ROOT/alpha" "$ROOT/beta"
printf '# Alpha\n' > "$ROOT/alpha/plan.md"
printf '# Beta\n' > "$ROOT/beta/plan.md"
EVENT="$SCRIPT_DIR/plan-event.sh"
bash "$EVENT" alpha PLAN 'Open alpha' alpha/plan.md
python3 - "$ROOT/TIMELINE.md" <<'PY'
import pathlib, sys
rows = pathlib.Path(sys.argv[1]).read_text().splitlines()
assert len(rows) == 1
assert rows[0].split(' | ')[1:] == ['alpha', 'PLAN', 'Open alpha', 'alpha/plan.md']
PY
printf 'ok - appends a complete event linked to the owning plan\n'
(
  for n in $(seq 1 30); do bash "$EVENT" alpha WORKING "alpha-$n" alpha/plan.md; done
) &
A=$!
(
  for n in $(seq 1 30); do bash "$EVENT" beta WORKING "beta-$n" beta/plan.md; done
) &
B=$!
wait "$A"
wait "$B"
python3 - "$ROOT/TIMELINE.md" <<'PY'
import pathlib, sys
rows = [line.split(' | ') for line in pathlib.Path(sys.argv[1]).read_text().splitlines()]
assert len(rows) == 61
assert all(len(row) == 5 for row in rows)
assert {row[3] for row in rows[1:]} == {f'{plan}-{i}' for plan in ('alpha', 'beta') for i in range(1, 31)}
assert all(row[4] == row[1] + '/plan.md' for row in rows)
PY
printf 'ok - concurrent plan coordinators append without lost or mixed events\n'
BEFORE="$(sha256sum "$ROOT/TIMELINE.md")"
for args in 'bad-name invalid message alpha/plan.md' 'alpha DONE message beta/plan.md' 'alpha DONE message alpha/missing.md' 'alpha DONE message alpha/../beta/plan.md'; do
  read -r -a words <<< "$args"
  if bash "$EVENT" "${words[@]}" 2>/dev/null; then echo 'FAIL: invalid event accepted' >&2; exit 1; fi
done
if bash "$EVENT" alpha WORKING $'multiline\nmessage' alpha/plan.md 2>/dev/null; then exit 1; fi
if bash "$EVENT" alpha WORKING 'bad | delimiter' alpha/plan.md 2>/dev/null; then exit 1; fi
[ "$(sha256sum "$ROOT/TIMELINE.md")" = "$BEFORE" ]
printf 'ok - rejects malformed events and cross-plan artifact references without append\n'
mkdir -p "$ROOT/archive/2026-10-22-alpha"
printf '# Report\n' > "$ROOT/archive/2026-10-22-alpha/report.md"
bash "$EVENT" alpha DONE 'Archived alpha' archive/2026-10-22-alpha/report.md
[ ! -e status ]
printf 'ok - supports archived artifact links without repo-local state\n'
LOCK="$(dirname "$ROOT")/.locks/$(basename "$ROOT").timeline.lock"
rm "$LOCK"
mkfifo "$LOCK"
if bash "$EVENT" alpha DONE 'Unsafe lock' alpha/plan.md 2>/dev/null; then exit 1; fi
rm "$LOCK"
mv "$ROOT/TIMELINE.md" "$TMP/saved-timeline"
mkfifo "$ROOT/TIMELINE.md"
if bash "$EVENT" alpha DONE 'Unsafe timeline' alpha/plan.md 2>/dev/null; then exit 1; fi
rm "$ROOT/TIMELINE.md"
mv "$TMP/saved-timeline" "$ROOT/TIMELINE.md"
printf 'ok - rejects non-regular timeline and lock paths without blocking\n'
printf 'all 5 checks passed\n'
