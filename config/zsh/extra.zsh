# extra.zsh — minimal extras (sourced via home/modules/shell/zsh.nix)

# CachyOS config provides extra aliases but clobbers HM's oh-my-zsh — save HM vars
local _HM_ZSH="$ZSH" _HM_ZSH_CUSTOM="$ZSH_CUSTOM"
if [[ -f /usr/share/cachyos-zsh-config/cachyos-config.zsh ]]; then
  # CachyOS oh-my-zsh gets its own completion dump — see zsh.nix ZSH_COMPDUMP.
  export ZSH_COMPDUMP="${ZDOTDIR:-$HOME}/.zcompdump-cachyos-${HOST%%.*}-${ZSH_VERSION}"
  source /usr/share/cachyos-zsh-config/cachyos-config.zsh
  export ZSH="$_HM_ZSH"
  export ZSH_CUSTOM="$_HM_ZSH_CUSTOM"
fi
unset _HM_ZSH _HM_ZSH_CUSTOM
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

# Restore PATH priority after CachyOS config source (typeset -U dedups
# against config/zsh/path.zsh entries) + extra tool dirs not in path.zsh.
export PATH="$HOME/.nix-profile/bin:/nix/var/nix/profiles/default/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/go/bin:$HOME/.cargo/bin:$PATH"
export PATH="$HOME/projects/sdk/flutter/bin:$PATH"
# Auto-load private env (never committed) — TOML only
# Order: ~/projects/dotfiles/.env.toml → ~/.env.toml
__load_toml_env() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  local _py_out
  _py_out=$(python3 - "$f" 2>/dev/null <<'PY'
import sys, tomllib, shlex, pathlib
p = pathlib.Path(sys.argv[1])
try:
    data = tomllib.load(open(p, "rb"))
except Exception as e:
    print(f"toml parse error {p}: {e}", file=sys.stderr)
    sys.exit(1)
def emit(k, v):
    # Gateway credentials belong to each profile's own .env under HERMES_HOME. Exporting them
    # into the session makes the CLI's "default" profile claim another profile's bot token.
    if k.startswith(("DISCORD_BOT_TOKEN", "DISCORD_ALLOWED_USERS", "OWNER_DISCORD_USER_ID")):
        return
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
  [[ -n "$_py_out" ]] && eval "$_py_out"
}

if [[ -f "$HOME/projects/dotfiles/.env.toml" ]]; then
  set -a; __load_toml_env "$HOME/projects/dotfiles/.env.toml"; set +a
elif [[ -f "$HOME/.env.toml" ]]; then
  set -a; __load_toml_env "$HOME/.env.toml"; set +a
fi
unset -f __load_toml_env 2>/dev/null || true

# Per-profile hermes env is NOT loaded into interactive shells: each profile's .env/.env.toml
# is owned by that profile's gateway (hermes_cli/env_loader under HERMES_HOME). Sourcing all of
# them here made the last profile (yola) overwrite DISCORD_BOT_TOKEN for every shell, which is
# exactly the collision `hermes gateway status` reports as a duplicate credential.

export HERMES_HOME="$HOME/apps/hermes"

# zoxide init — smart cd (`z <keyword>`); noop until zoxide is installed
command -v zoxide >/dev/null 2>&1 && eval "$(zoxide init zsh)"

# codegraph helpers — per-project index, no account-wide store: each repo needs
# its own `.codegraph/` (`codegraph init`; `codegraph sync` re-syncs; `codegraph
# status` inspects). Both take an optional path (default $PWD).
# NEVER index $HOME or / — refused explicitly here (codegraph init also refuses
# home/root without --force).
export CODEGRAPH_TELEMETRY=0
_codegraph_safe_target() {
  local t="${1:A}"
  if [[ "$t" == "${HOME:A}" || "$t" == "/" ]]; then
    print -u2 "codegraph: refusing '$t' — home/root is never a codegraph project"
    return 1
  fi
  print -r -- "$t"
}
cgi() {
  local target
  target="$(_codegraph_safe_target "${1:-$PWD}")" || return 1
  local probe="$target" indexed=
  while [[ -n "$probe" && "$probe" != / ]]; do
    [[ -d "$probe/.codegraph" ]] && { indexed=1; break; }
    probe="${probe:h}"
  done
  if [[ -n "$indexed" ]]; then
    codegraph sync "$target"
  else
    codegraph init "$target"
  fi
  codegraph status "$target"
}

cgs() {
  local target
  target="$(_codegraph_safe_target "${1:-$PWD}")" || return 1
  codegraph status "$target"
}

# Unity CLI needs the graphical session variables even when the shell was
# started outside KDE (e.g. from a daemon or an IDE). Pull the missing values
# from the systemd user manager so `unity open` works without a prefix. The
# external `env` call keeps this function from recursing into itself.
unity() {
  local display="${DISPLAY:-}"
  local wayland="${WAYLAND_DISPLAY:-}"
  local xauth="${XAUTHORITY:-}"
  if [[ -z "$display" || -z "$xauth" ]]; then
    local envdump
    envdump=$(systemctl --user show-environment 2>/dev/null)
    [[ -z "$display" ]] && display=$(print -r -- "$envdump" | sed -n 's/^DISPLAY=//p' | head -n1)
    [[ -z "$wayland" ]] && wayland=$(print -r -- "$envdump" | sed -n 's/^WAYLAND_DISPLAY=//p' | head -n1)
    [[ -z "$xauth" ]] && xauth=$(print -r -- "$envdump" | sed -n 's/^XAUTHORITY=//p' | head -n1)
  fi
  if [[ -z "$xauth" ]]; then
    local candidate
    for candidate in "${XDG_RUNTIME_DIR:-/run/user/$UID}"/xauth_*(N); do
      xauth="$candidate"
      break
    done
  fi

  local -a unity_env
  [[ -n "$display" ]] && unity_env+=("DISPLAY=$display")
  [[ -n "$wayland" ]] && unity_env+=("WAYLAND_DISPLAY=$wayland")
  [[ -n "$xauth" ]] && unity_env+=("XAUTHORITY=$xauth")
  command env "${unity_env[@]}" unity "$@"
}
