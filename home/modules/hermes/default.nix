{ config, pkgs, lib, ... }:
{
  xdg.configFile."hermes".source = ../../../config/hermes;
  xdg.configFile."hermes".recursive = true;

  home.activation.hermesSync = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    DOTFILES_PROFILES="$HOME/projects/dotfiles/config/hermes/profiles"
    LIVE_PROFILES="$HOME/apps/hermes/profiles"
    if [ -d "$DOTFILES_PROFILES" ]; then
      mkdir -p "$LIVE_PROFILES"
      for src in "$DOTFILES_PROFILES"/*; do
        [ -e "$src" ] || continue
        name=$(basename "$src")
        dest="$LIVE_PROFILES/$name"
        if [ ! -e "$dest" ]; then
          $DRY_RUN_CMD cp -r "$src" "$dest"
          $DRY_RUN_CMD chmod -R u+w "$dest" 2>/dev/null || true
        fi
      done
      # seed top-level install script if missing
      if [ -f "$HOME/projects/dotfiles/config/hermes/install-hermes.sh" ] && [ ! -f "$LIVE_PROFILES/../install-hermes.sh" ]; then
        $DRY_RUN_CMD cp -n "$HOME/projects/dotfiles/config/hermes/install-hermes.sh" "$LIVE_PROFILES/../install-hermes.sh" 2>/dev/null || true
      fi
    fi
  '';

  home.activation.hermesPerProfileEnv = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    # Per-profile env: each suite (channel+token+owner+profile) maps to a hermes profile.
    # HERMES_PROFILE_n optional — if empty, falls back to default profile for that suite.
    #   _2 -> yola (1531031722064478279), _3 -> game-dev-team
    # Writes both .env.toml (systemd import via home/modules/env) and .env
    # (agent/secret_scope + hermes_cli/env_loader).
    _toml="$HOME/projects/dotfiles/.env.toml"
    if [ -f "$_toml" ]; then
      _yola_token=$(${pkgs.python3}/bin/python3 - "$_toml" 2>/dev/null <<'PY'
import tomllib, pathlib, sys
p = pathlib.Path(sys.argv[1])
try:
    data = tomllib.load(open(p, "rb"))
except Exception:
    sys.exit(0)
print(data.get("DISCORD_BOT_TOKEN_2", "") or data.get("DISCORD_BOT_TOKEN_YOLA", "") or "")
PY
)
      _yola_owner=$(${pkgs.python3}/bin/python3 - "$_toml" 2>/dev/null <<'PY'
import tomllib, pathlib, sys
p = pathlib.Path(sys.argv[1])
try:
    data = tomllib.load(open(p, "rb"))
except Exception:
    sys.exit(0)
print(data.get("OWNER_DISCORD_USER_ID_2", "") or data.get("OWNER_DISCORD_USER_ID", "") or "")
PY
)
      _yola_profile=$(${pkgs.python3}/bin/python3 - "$_toml" 2>/dev/null <<'PY'
import tomllib, pathlib, sys
p = pathlib.Path(sys.argv[1])
try:
    data = tomllib.load(open(p, "rb"))
except Exception:
    sys.exit(0)
# optional — fallback to default "yola" if empty
print(data.get("HERMES_PROFILE_2", "") or data.get("HERMES_PROFILE", "") or "yola")
PY
)
      _gdev_token=$(${pkgs.python3}/bin/python3 - "$_toml" 2>/dev/null <<'PY'
import tomllib, pathlib, sys
p = pathlib.Path(sys.argv[1])
try:
    data = tomllib.load(open(p, "rb"))
except Exception:
    sys.exit(0)
print(data.get("DISCORD_BOT_TOKEN_3", "") or "")
PY
)
      _gdev_owner=$(${pkgs.python3}/bin/python3 - "$_toml" 2>/dev/null <<'PY'
import tomllib, pathlib, sys
p = pathlib.Path(sys.argv[1])
try:
    data = tomllib.load(open(p, "rb"))
except Exception:
    sys.exit(0)
print(data.get("OWNER_DISCORD_USER_ID_3", "") or data.get("OWNER_DISCORD_USER_ID", "") or "")
PY
)
      _gdev_profile=$(${pkgs.python3}/bin/python3 - "$_toml" 2>/dev/null <<'PY'
import tomllib, pathlib, sys
p = pathlib.Path(sys.argv[1])
try:
    data = tomllib.load(open(p, "rb"))
except Exception:
    sys.exit(0)
print(data.get("HERMES_PROFILE_3", "") or "game-dev-team")
PY
)
      if [ -n "$_yola_token" ]; then
        mkdir -p "$HOME/apps/hermes/profiles/$_yola_profile"
        $DRY_RUN_CMD bash -c 'printf "DISCORD_BOT_TOKEN = \"%s\"\nOWNER_DISCORD_USER_ID = \"%s\"\nDISCORD_ALLOWED_USERS = \"%s\"\n" "$1" "$2" "$2" > "$HOME/apps/hermes/profiles/$3/.env.toml"' -- "$_yola_token" "$_yola_owner" "$_yola_profile"
        $DRY_RUN_CMD ${pkgs.python3}/bin/python3 - "$_yola_token" "$_yola_owner" "$_yola_profile" <<'PY'
import sys, pathlib
token, owner, prof = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path.home() / f"apps/hermes/profiles/{prof}/.env"
lines = []
if p.exists():
    lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
out = []
has_token = has_owner = has_allowed = False
for l in lines:
    if l.startswith("DISCORD_BOT_TOKEN="):
        out.append(f"DISCORD_BOT_TOKEN={token}")
        has_token = True
    elif l.startswith("OWNER_DISCORD_USER_ID="):
        out.append(f"OWNER_DISCORD_USER_ID={owner}")
        has_owner = True
    elif l.startswith("DISCORD_ALLOWED_USERS="):
        out.append(f"DISCORD_ALLOWED_USERS={owner}")
        has_allowed = True
    else:
        out.append(l)
if not has_token:
    out.append(f"DISCORD_BOT_TOKEN={token}")
if not has_owner:
    out.append(f"OWNER_DISCORD_USER_ID={owner}")
if not has_allowed:
    out.append(f"DISCORD_ALLOWED_USERS={owner}")
p.write_text("\n".join(out) + "\n", encoding="utf-8")
PY
        $DRY_RUN_CMD chmod 600 "$HOME/apps/hermes/profiles/$_yola_profile/.env.toml" "$HOME/apps/hermes/profiles/$_yola_profile/.env" 2>/dev/null || true
      fi
      if [ -n "$_gdev_token" ]; then
        mkdir -p "$HOME/apps/hermes/profiles/$_gdev_profile"
        $DRY_RUN_CMD bash -c 'printf "DISCORD_BOT_TOKEN = \"%s\"\nOWNER_DISCORD_USER_ID = \"%s\"\nDISCORD_ALLOWED_USERS = \"%s\"\n" "$1" "$2" "$2" > "$HOME/apps/hermes/profiles/$3/.env.toml"' -- "$_gdev_token" "$_gdev_owner" "$_gdev_profile"
        $DRY_RUN_CMD ${pkgs.python3}/bin/python3 - "$_gdev_token" "$_gdev_owner" "$_gdev_profile" <<'PY'
import sys, pathlib
token, owner, prof = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path.home() / f"apps/hermes/profiles/{prof}/.env"
lines = []
if p.exists():
    lines = p.read_text(encoding="utf-8", errors="ignore").splitlines()
out = []
has_token = has_owner = has_allowed = False
for l in lines:
    if l.startswith("DISCORD_BOT_TOKEN="):
        out.append(f"DISCORD_BOT_TOKEN={token}")
        has_token = True
    elif l.startswith("OWNER_DISCORD_USER_ID="):
        out.append(f"OWNER_DISCORD_USER_ID={owner}")
        has_owner = True
    elif l.startswith("DISCORD_ALLOWED_USERS="):
        out.append(f"DISCORD_ALLOWED_USERS={owner}")
        has_allowed = True
    else:
        out.append(l)
if not has_token:
    out.append(f"DISCORD_BOT_TOKEN={token}")
if not has_owner:
    out.append(f"OWNER_DISCORD_USER_ID={owner}")
if not has_allowed:
    out.append(f"DISCORD_ALLOWED_USERS={owner}")
p.write_text("\n".join(out) + "\n", encoding="utf-8")
PY
        $DRY_RUN_CMD chmod 600 "$HOME/apps/hermes/profiles/$_gdev_profile/.env.toml" "$HOME/apps/hermes/profiles/$_gdev_profile/.env" 2>/dev/null || true
      fi
    fi
    unset _toml _yola_token _yola_owner _yola_profile _gdev_token _gdev_owner _gdev_profile 2>/dev/null || true
  '';

  home.activation.hermesYolaSplit = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    # One-time cleanup: remove yola route from live yohanes multiplex config
    # (dotfiles source already patched; live copy via hermesSync is copy-if-missing only)
    _live="$HOME/apps/hermes/profiles/yohanes/config.yaml"
    if [ -f "$_live" ] && grep -q "1531031722064478279" "$_live" 2>/dev/null; then
      $DRY_RUN_CMD ${pkgs.python3}/bin/python3 - "$_live" <<'PY'
import pathlib, sys, re
p = pathlib.Path(sys.argv[1])
t = p.read_text(encoding="utf-8")
# remove the casual/yola route block (4 lines)
t = re.sub(r"    - name: casual\n      platform: discord\n      chat_id: '1531031722064478279'\n      profile: yola\n", "", t)
p.write_text(t, encoding="utf-8")
print("patched live yohanes config: removed yola route")
PY
    fi
    unset _live 2>/dev/null || true
  '';

  systemd.user.services.hermes-config-sync = {
    Unit.Description = "Sync Hermes configs from live to dotfiles (every 5 min)";
    Service = {
      Type = "oneshot";
      ExecStart = "/usr/bin/python3 %h/projects/dotfiles/scripts/sync-hermes-config.py";
      StandardOutput = "journal";
      StandardError = "journal";
    };
  };

  systemd.user.timers.hermes-config-sync = {
    Unit.Description = "Hermes config sync timer (every 5 min)";
    Timer = {
      OnCalendar = "*:0/5";
      Persistent = true;
    };
    Install.WantedBy = [ "timers.target" ];
  };
}
