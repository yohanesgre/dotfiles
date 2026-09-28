#!/usr/bin/env bash
# Headless screenshot of a local HTML file for visual QA of architecture viz pages.
# Usage: render-check.sh <file.html> <out.png> [width] [height]
# Prints the screenshot path on success.
#
# Exit codes:
#   0 = a fresh PNG was written
#   1 = a browser was found but produced no fresh PNG (its stderr is shown)
#   2 = usage error, missing file, or non-positive/non-integer width or height
#   3 = no chromium/chrome found
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "usage: render-check.sh <file.html> <out.png> [width] [height]" >&2
  exit 2
fi

FILE=$(realpath "$1")
OUT=$2
W=${3:-1400}
H=${4:-3500}

is_pos_int() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -gt 0 ]
}

for n in "$W" "$H"; do
  if ! is_pos_int "$n"; then
    echo "render-check: width/height must be positive integers (got W=$W H=$H)" >&2
    exit 2
  fi
done

if [ ! -f "$FILE" ]; then
  echo "render-check: file not found: $FILE" >&2
  exit 2
fi

start=$(date +%s)
rm -f -- "$OUT"
errlog=$(mktemp "${TMPDIR:-/tmp}/render-check.XXXXXX")
trap 'rm -f -- "$errlog"' EXIT

mtime() { stat -c %Y -- "$1" 2>/dev/null || stat -f %m -- "$1"; }

found=""
for BIN in chromium chromium-browser google-chrome google-chrome-stable; do
  command -v "$BIN" >/dev/null 2>&1 || continue
  found="$BIN"
  for MODE in "--headless=new" "--headless"; do
    rm -f -- "$OUT"
    if "$BIN" "$MODE" --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
        --window-size="${W},${H}" --virtual-time-budget=4000 \
        --screenshot="$OUT" "file://$FILE" >/dev/null 2>"$errlog"; then
      if [ -s "$OUT" ] && [ "$(mtime "$OUT")" -ge "$start" ]; then
        echo "$OUT"
        exit 0
      fi
    fi
    echo "render-check: $BIN $MODE produced no fresh PNG; last output:" >&2
    tail -n 10 "$errlog" >&2 || true
  done
done

if [ -z "$found" ]; then
  echo "render-check: no chromium/chrome found — open file://$FILE manually" >&2
  exit 3
fi

echo "render-check: $found ran but produced no fresh PNG at $OUT" >&2
exit 1
