#!/usr/bin/env bash
# load-env.sh — export private env into current shell + systemd user env
# TOML only (.env.toml)
# Usage: source scripts/load-env.sh  |  bash scripts/load-env.sh
set -euo pipefail

DOTFILES_TOML="$HOME/projects/dotfiles/.env.toml"
GLOBAL_TOML="$HOME/.env.toml"

_py=python3
if ! command -v "$_py" >/dev/null 2>&1; then _py=python3; fi

_load_toml_one() {
    local f="$1"
    [[ -f "$f" ]] || return 0
    echo "loading $f (TOML)"
    local out keys
    out=$("$_py" - "$f" 2>/dev/null <<'PY'
import sys, tomllib, shlex, pathlib
p = pathlib.Path(sys.argv[1])
try:
    data = tomllib.load(open(p, "rb"))
except Exception as e:
    print(f"toml parse error {p}: {e}", file=sys.stderr)
    sys.exit(1)
def emit(k, v):
    if isinstance(v, dict):
        for sk, sv in v.items():
            emit(f"{k}_{sk}", sv)
        return
    if isinstance(v, bool):
        v = str(v).lower()
    elif v is None:
        v = ""
    else:
        v = str(v)
    print(f"export {k}={shlex.quote(v)}")
for k, v in data.items():
    emit(k, v)
PY
) || { echo "failed to parse $f" >&2; return 1; }
    eval "$out"
    if command -v systemctl >/dev/null 2>&1; then
        keys=$( "$_py" - "$f" 2>/dev/null <<'PY' | xargs 2>/dev/null || true
import sys, tomllib, pathlib
p = pathlib.Path(sys.argv[1])
try:
    data = tomllib.load(open(p, "rb"))
except Exception:
    sys.exit(1)
def keys(k, v):
    if isinstance(v, dict):
        for sk, sv in v.items():
            yield from keys(f"{k}_{sk}", sv)
    else:
        yield k
for k, v in data.items():
    for kk in keys(k, v):
        print(kk)
PY
)
        if [[ -n "$keys" ]]; then
            # shellcheck disable=SC2086
            systemctl --user import-environment $keys 2>/dev/null || true
        fi
    fi
}

# Canonical: TOML only per base
if [[ -f "$DOTFILES_TOML" ]]; then
    _load_toml_one "$DOTFILES_TOML"
elif [[ -f "$GLOBAL_TOML" ]]; then
    _load_toml_one "$GLOBAL_TOML"
fi

# Hermes per-profile: TOML only
for hf in "$HOME/apps/hermes/profiles"/*/.env.toml; do
    [[ -f "$hf" ]] && _load_toml_one "$hf"
done

echo "done"
