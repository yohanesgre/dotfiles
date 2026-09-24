{
  config,
  lib,
  pkgs,
  ...
}:
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

        # Hermes per-profile .env.toml NOT loaded globally — each gateway reads its
        # own profile's .env.toml via hermes_cli/env_loader (HERMES_HOME). Loading them
        # here would collide DISCORD_BOT_TOKEN (yola overwrites yohanes).

        unset _py _out _keys _toml_file _base
        unset -f _load_toml 2>/dev/null || true
  '';

  # jev-mcp reads its key from ~/.config/typesafe/key (its JEV_KEY_FILE default).
  # Writing it here from .env.toml removes the MCP child's dependency on the
  # daemonized opencode service inheriting the systemd user env: an empty
  # TYPESAFE_API_KEY in that env is not nullish, so it would win over the file
  # and poison every judgment with an auth error. Never echoed to the log.
  home.activation.writeTypeSafeKey = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        _py=${pkgs.python3}/bin/python3
        if ! [ -x "$_py" ]; then _py=python3; fi

        _toml=""
        for _base in "$HOME/projects/dotfiles" "$HOME"; do
          if [ -f "$_base/.env.toml" ]; then _toml="$_base/.env.toml"; break; fi
        done

        if [ -n "$_toml" ]; then
          _key=$("$_py" - "$_toml" 2>/dev/null <<'PY'
    import sys, tomllib
    try:
        data = tomllib.load(open(sys.argv[1], "rb"))
    except Exception:
        sys.exit(0)
    print(data.get("TYPESAFE_API_KEY", ""))
    PY
    )
          if [ -n "$_key" ]; then
            _tmp=$(mktemp)
            printf '%s\n' "$_key" > "$_tmp"
            if ! cmp -s "$_tmp" "$HOME/.config/typesafe/key" 2>/dev/null; then
              $DRY_RUN_CMD mkdir -p "$HOME/.config/typesafe"
              $DRY_RUN_CMD install -m 600 "$_tmp" "$HOME/.config/typesafe/key"
              echo "env: wrote jev key file ~/.config/typesafe/key (0600)"
            fi
            rm -f "$_tmp"
          else
            echo "env: TYPESAFE_API_KEY empty in $_toml — key file untouched" >&2
          fi
        fi
        unset _py _toml _key _tmp _base
  '';
}
