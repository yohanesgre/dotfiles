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

# Also load per-profile hermes env files if present (TOML only)
__load_toml_env_hermes() {
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
for _hf in "$HOME/apps/hermes/profiles"/*/.env.toml(N); do [[ -f "$_hf" ]] && { set -a; __load_toml_env_hermes "$_hf"; set +a; }; done 2>/dev/null
unset _hf
unset -f __load_toml_env_hermes 2>/dev/null || true

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
