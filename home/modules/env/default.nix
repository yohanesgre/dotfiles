{ config, lib, pkgs, ... }:
{
  home.activation.loadDotEnv = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    _py=${pkgs.python3}/bin/python3
    if ! [ -x "$_py" ]; then _py=python3; fi

    # helper: load TOML and export vars + return keys
    _load_toml() {
      _toml_file="$1"
      [ -f "$_toml_file" ] || return 1
      echo "env: loading $_toml_file → systemd user env (TOML)"
      _out=$("$_py" - "$_toml_file" 2>/dev/null <<'PY'
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
) || return 1
      eval "$_out"
      _keys=$("$_py" - "$_toml_file" 2>/dev/null <<'PY' | xargs 2>/dev/null || true
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
      if [ -n "$_keys" ]; then
        ${pkgs.systemd}/bin/systemctl --user import-environment $_keys 2>/dev/null || true
      fi
      return 0
    }

    # Canonical locations: TOML only
    for _base in "$HOME/projects/dotfiles" "$HOME"; do
      if [ -f "$_base/.env.toml" ]; then
        _load_toml "$_base/.env.toml"
      fi
    done

    # Hermes per-profile: TOML only
    for _hf in "$HOME/apps/hermes/profiles"/*/.env.toml; do
      [ -f "$_hf" ] && _load_toml "$_hf"
    done

    unset _py _out _keys _toml_file _base _hf
    unset -f _load_toml 2>/dev/null || true
  '';
}
