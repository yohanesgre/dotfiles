# extra.zsh — minimal extras (sourced via home/modules/shell/zsh.nix)

[[ -f /usr/share/cachyos-zsh-config/cachyos-config.zsh ]] && source /usr/share/cachyos-zsh-config/cachyos-config.zsh
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

export PATH="$HOME/go/bin:$HOME/.bun/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
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

alias ld="lazydocker"
alias dc="docker compose"
alias dps="docker ps"

[[ -f "$HOME/projects/google-cloud-sdk/path.zsh.inc" ]] && source "$HOME/projects/google-cloud-sdk/path.zsh.inc"
[[ -f "$HOME/projects/google-cloud-sdk/completion.zsh.inc" ]] && source "$HOME/projects/google-cloud-sdk/completion.zsh.inc"

tmuxhelp() {
  cat <<'EOF'
TMUX CHEAT SHEET
================
  to <name>      tmux new-session -A -s <name>   attach/create (most-used)
  ta <name>      tmux attach -t <name>
  ts <name>      tmux new-session -s <name>      create new
  tl             tmux list-sessions
  tkss <name>    tmux kill-session -t <name>
  tksv           tmux kill-server
  tds            tmux new -As <dir>-<hash>       session per folder
  tmuxconf       $EDITOR ~/.tmux.conf
Inside tmux (prefix Ctrl-a):
  ?              this help
  c              new window
  n/p Tab        next/prev/last window
  | -            split h/v
  h j k l        move panes
  H J K L        resize panes
  z              zoom pane
  x              close pane
  , $            rename window/session
  d              detach
  r              reload config
  Ctrl-s/r       save/restore (resurrect)
  I              install plugins
EOF
}
