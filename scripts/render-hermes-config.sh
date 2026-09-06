#!/usr/bin/env bash
# render-hermes-config.sh — inject channel IDs into LIVE hermes configs.
# Tracked templates keep @HERMES_HOME_*@ placeholders (no raw IDs in git).
# Live files live in ~/apps/hermes/profiles/*/config.yaml (gitignored runtime).
# Usage:
#   bash scripts/render-hermes-config.sh            # render live from .env.toml
#   bash scripts/render-hermes-config.sh --check    # verify no placeholders left live
# Env: ~/projects/dotfiles/.env.toml, fallback ~/.env.toml (never committed).
set -euo pipefail

DOTFILES_TOML="$HOME/projects/dotfiles/.env.toml"
GLOBAL_TOML="$HOME/.env.toml"
LIVE_DIR="$HOME/apps/hermes/profiles"

CHECK=false
[ "${1:-}" = "--check" ] && CHECK=true

ENV_FILE=""
[ -f "$DOTFILES_TOML" ] && ENV_FILE="$DOTFILES_TOML" || ENV_FILE="$GLOBAL_TOML"
if [ ! -f "$ENV_FILE" ]; then
  echo "render-hermes: no env file ($DOTFILES_TOML or $GLOBAL_TOML) — skipping"
  exit 0
fi

MAP=$(python3 - "$ENV_FILE" <<'PY'
import sys, tomllib, pathlib
p = pathlib.Path(sys.argv[1])
try:
    data = tomllib.load(open(p, "rb"))
except Exception as e:
    print(f"toml parse error: {e}", file=sys.stderr)
    sys.exit(1)
def flat(d, prefix=""):
    for k, v in d.items():
        key = f"{prefix}{k}" if not prefix else f"{prefix}_{k}"
        if isinstance(v, dict):
            yield from flat(v, key)
        else:
            yield (key, "" if v is None else str(v))
env = dict(flat(data))
wanted = {
    "@HERMES_HOME_YOHANES@": env.get("HERMES_HOME_YOHANES", ""),
    "@HERMES_HOME_YOLA@": env.get("HERMES_HOME_YOLA", ""),
    "@HERMES_HOME_GAMEDEV@": env.get("HERMES_HOME_GAMEDEV", ""),
}
missing = sorted(ph for ph, v in wanted.items() if not v)
for ph, v in wanted.items():
    if v:
        print(f"{ph}={v}")
if missing:
    print(f"MISSING:{','.join(missing)}", file=sys.stderr)
    sys.exit(2)
# drift warnings: home should be a member of its CHANNEL list
def members(key):
    return [x.strip() for x in env.get(key, "").split(",") if x.strip()]
checks = [
    ("@HERMES_HOME_YOHANES@", "DISCORD_CHANNEL_ID"),
    ("@HERMES_HOME_YOLA@", "DISCORD_CHANNEL_ID_2"),
    ("@HERMES_HOME_GAMEDEV@", "DISCORD_CHANNEL_ID_3"),
]
for ph, ck in checks:
    vals, ms = wanted[ph], members(ck)
    if ms and vals not in ms:
        print(f"WARN:{ph} not a member of {ck} (multiplex/drift?)", file=sys.stderr)
PY
) || {
  echo "render-hermes: missing vars in $ENV_FILE — fill HERMES_HOME_YOHANES/YOLA/GAMEDEV (see .env.toml.example)"
  exit 1
}

LEFTOVER=0
for f in "$LIVE_DIR"/*/config.yaml; do
  [ -f "$f" ] || continue
  if ! grep -q "@HERMES_HOME_" "$f" 2>/dev/null; then continue; fi
  tmp="$f.tmp.$$"
  cp "$f" "$tmp"
  while IFS='=' read -r ph val; do
    [ -n "$ph" ] || continue
    python3 - "$tmp" "$ph" "$val" <<'PY'
import sys, pathlib
p, ph, val = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
t = p.read_text(encoding="utf-8")
p.write_text(t.replace(ph, val), encoding="utf-8")
PY
  done <<< "$MAP"
  mv "$tmp" "$f"
  echo "render-hermes: rendered $f"
done

if grep -rq "@HERMES_HOME_" "$LIVE_DIR" 2>/dev/null; then
  echo "render-hermes: placeholders remain live:"
  grep -rln "@HERMES_HOME_" "$LIVE_DIR"
  LEFTOVER=1
fi

if [ "$CHECK" = true ]; then
  [ "$LEFTOVER" -eq 0 ] && echo "render-hermes --check: PASS" || { echo "render-hermes --check: FAIL"; exit 1; }
elif [ "$LEFTOVER" -ne 0 ]; then
  exit 1
fi
