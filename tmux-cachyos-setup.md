# CachyOS — tmux setup (handoff instructions for an agent)

Paste this block to the agent running on the CachyOS machine. It replicates the
beginner tmux setup from the macOS machine (kitty-tuned, oh-my-zsh, tpm +
tmux-resurrect + tmux-continuum, autostart).

```
TASK: Set up a beginner-friendly tmux config on CachyOS (Arch), identical to the one on the
user's macOS machine (kitty terminal, oh-my-zsh, tpm + tmux-resurrect + tmux-continuum).

STEP 1 — Install dependencies
  sudo pacman -S --needed tmux git
  Verify: tmux -V  (must be >= 3.0, ideally 3.4+)

STEP 2 — Determine the terminal
  Run: echo $TERM  (and check what terminal app they use)
  - If it's kitty: keep the config as-is below.
  - If it's ANYTHING else: replace every occurrence of `xterm-kitty` in ~/.tmux.conf
    with `tmux-256color` (safe for gnome-terminal/konsole/wezterm/etc).
    NOTE: if the terminal app is NOT kitty, clipboard copy may not work unless the
    terminal supports OSC 52 (most modern ones do; verify with prefix+C-s after setup).

STEP 3 — Write ~/.tmux.conf with EXACTLY this content:
# ============================================================
# ~/.tmux.conf — beginner-friendly, tuned for kitty
# ============================================================
# After editing: press  prefix + r  to reload (prefix = Ctrl-a)
# Press  prefix + ?  any time for a cheat-sheet menu.
#
# Kitty note: kitty's own shortcuts are all Ctrl+Shift+...,
# so nothing here collides with the terminal.

# ------------------------------------------------------------
# Prefix: Ctrl-a  (Ctrl-b is a stretch on many keyboards)
# ------------------------------------------------------------
set -g prefix C-a
unbind C-b
bind C-a send-prefix          # double-tap C-a to type a literal Ctrl-a

# ------------------------------------------------------------
# Sanity numbering: windows and panes start at 1, not 0
# ------------------------------------------------------------
set -g base-index 1
setw -g pane-base-index 1
set -g renumber-windows on    # close window 2 -> 3 becomes 2

# ------------------------------------------------------------
# Mouse: click to focus, drag borders to resize, wheel to scroll
# ------------------------------------------------------------
set -g mouse on
# Hold Shift while selecting text to copy it natively (kitty feature).

# Copy-mode yanks go straight to the clipboard (OSC 52)
set -g set-clipboard on

# Snappier Escape response for vim/neovim
set -g escape-time 10

# More scrollback (default is 2000 lines)
set -g history-limit 10000

# Tell programs inside tmux they're in the right terminal -> correct colors/italics
set -g default-terminal "xterm-kitty"

# ------------------------------------------------------------
# Splits with intuitive keys
# ------------------------------------------------------------
bind | split-window -h        # prefix + |  -> side-by-side
bind - split-window -v        # prefix + -  -> stacked

# Move between panes with vim keys
bind h select-pane -L
bind j select-pane -D
bind k select-pane -U
bind l select-pane -R

# Resize panes: hold prefix, press H/J/K/L repeatedly
bind -r H resize-pane -L 5
bind -r J resize-pane -D 5
bind -r K resize-pane -U 5
bind -r L resize-pane -R 5

# Reload config with prefix + r
bind r source-file ~/.tmux.conf \; display-message "Config reloaded"

# ------------------------------------------------------------
# Status bar (Catppuccin-ish; reads well in kitty)
# ------------------------------------------------------------
set -g status-style bg=#1e1e2e,fg=#cdd6f4
set -g status-left "#[bg=#89b4fa,fg=#1e1e2e,bold] #S "
set -g status-right "#[fg=#a6adc8] %a %b %d  %H:%M "
set -g window-status-format " #I:#W "
set -g window-status-current-format " #I:#W "
set -g window-status-current-style fg=#89b4fa,bold

# ------------------------------------------------------------
# prefix + ? -> quick cheat-sheet menu (replaces the raw key list)
# ------------------------------------------------------------
bind ? display-menu -T "tmux quick help" \
  "New window  (prefix+c)" c { new-window } \
  "Split side-by-side  (prefix+|)" | { split-window -h } \
  "Split stacked  (prefix+-)" - { split-window -v } \
  "Close current pane  (prefix+x)" x { confirm-before -p "kill-pane #P?" kill-pane } \
  "Zoom pane  (prefix+z)" z { resize-pane -Z } \
  "Rename window  (prefix+,)" , { command-prompt -I "#W" "rename-window '%%'" } \
  "Detach  (prefix+d)" d { detach-client } \
  "Reload config  (prefix+r)" r { source-file ~/.tmux.conf }

# ------------------------------------------------------------
# Plugins via tpm (Tmux Plugin Manager)
#   prefix + I  -> install/update plugins listed below
# ------------------------------------------------------------
set -g @plugin 'tmux-plugins/tmux-sensible'     # sane defaults
set -g @plugin 'tmux-plugins/tmux-resurrect'    # prefix+Ctrl-s save / Ctrl-r restore
set -g @plugin 'tmux-plugins/tmux-continuum'    # auto-save every 15 min

# Restore the saved session automatically after a reboot
set -g @continuum-restore 'on'

run '~/.tmux/plugins/tpm/tpm'

# ------------------------------------------------------------
# Re-assert terminal + status-bar settings AFTER plugins load
# (plugins can override these; last write wins)
# ------------------------------------------------------------
set -g default-terminal "xterm-kitty"
set -g status-style bg=#1e1e2e,fg=#cdd6f4
set -g status-left "#[bg=#89b4fa,fg=#1e1e2e,bold] #S "
set -g status-right "#[fg=#a6adc8] %a %b %d  %H:%M "
set -g window-status-format " #I:#W "
set -g window-status-current-format " #I:#W "
set -g window-status-current-style fg=#89b4fa,bold

STEP 4 — Install tpm + plugins (IMPORTANT: exact order, there is a known gotcha)
  git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
  Start a tmux session:  tmux new -s setup
  INSIDE that session run BOTH of these (the source-file first is REQUIRED —
  the install script needs TMUX_PLUGIN_MANAGER_PATH which only exists after
  the config's `run` line has executed in the server):
    tmux source-file ~/.tmux.conf
    ~/.tmux/plugins/tpm/bin/install_plugins
  NOTE: current tpm names the script `install_plugins` (no `.sh`). Older
  versions/docs used `install_plugins.sh` — if it doesn't exist, run
  `install_plugins`. Then START A FRESH tmux server (kill-server + new
  session) so the config's `run` line loads the newly cloned plugins.
  All three plugins must install (watch for the "Done" line).
  If a plugin fails: re-run the install script, then check ~/.tmux/plugins/ has
  tmux-sensible/, tmux-resurrect/, tmux-continuum/ directories.

STEP 5 — zsh setup (check first: does the default shell use oh-my-zsh?)
  Run: echo $SHELL; ls -d ~/.oh-my-zsh
  IF oh-my-zsh exists:
    - Add these 3 lines ABOVE the `plugins=(...)` line in ~/.zshrc:
      ZSH_TMUX_AUTOSTART=true            # auto-enter tmux when opening a terminal
      ZSH_TMUX_AUTOQUIT=false            # keep the terminal open after detaching
      ZSH_TMUX_DEFAULT_SESSION_NAME=main # session name used by autostart / `to`
    - Add `tmux` to the plugins=(...) list, e.g. plugins=(git tmux)
    - Append this function to the END of ~/.zshrc:
      tmuxhelp() {
        cat <<'EOF'
      TMUX CHEAT SHEET
      ================

      Shell commands (shortcut = what it runs):
        to <name>      tmux new-session -A -s <name>   attach or create (most-used)
        ta <name>      tmux attach -t <name>           attach to session
        ts <name>      tmux new-session -s <name>      create new session
        tl             tmux list-sessions              list sessions
        tkss <name>    tmux kill-session -t <name>     kill session
        tksv           tmux kill-server                kill all sessions
        tds            tmux new -As <dir>-<hash>       session named after current folder
        tmuxconf       $EDITOR ~/.tmux.conf            edit tmux config

      Inside tmux (prefix = Ctrl-a):
        ?              open this menu (quick help)
        c              new window
        |  /  -        split side-by-side / stacked
        h j k l        move between panes
        H J K L        resize panes
        z              zoom/unzoom pane
        x              close pane
        ,              rename window
        d              detach (terminal stays open)
        r              reload config
        Ctrl-s         save session (resurrect)
        Ctrl-r         restore session
        I              install/update tmux plugins
      EOF
      }
  IF zsh but NO oh-my-zsh: install oh-my-zsh (sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)") then apply the above.
  IF not zsh at all: skip this step entirely and report it.

  CACHYOS NOTE (what was done on this machine):
  CachyOS ships oh-my-zsh system-wide at /usr/share/oh-my-zsh and loads it via
  /usr/share/cachyos-zsh-config/cachyos-config.zsh (sourced from ~/.zshrc). So
  `ls -d ~/.oh-my-zsh` says "no" but omz IS active — do NOT install a home copy.
  The system config only sets plugins=(git fzf extract) if `plugins` is unset,
  so the correct additive edit is, BEFORE the `source cachyos-config.zsh` line:
    plugins=(git fzf extract tmux)
    ZSH_TMUX_AUTOSTART=true
    ZSH_TMUX_AUTOQUIT=false
    ZSH_TMUX_DEFAULT_SESSION_NAME=main
  and append the tmuxhelp function at the END of ~/.zshrc. This preserves the
  curated CachyOS/p10k setup — nothing under /usr/share is modified.

STEP 6 — VERIFY (all checks must pass before reporting done):
  1. tmux show-options -g default-terminal    -> xterm-kitty (or the replacement you chose)
  2. tmux list-keys | grep 'display-menu'     -> the quick-help binding with { } braces visible
  3. In an attached tmux session, press Ctrl-a then ?  -> cheat-sheet menu opens with all 8
     items. MUST NOT show "Not enough arguments" (that error means the { } braces are missing).
  4. tmux list-keys | grep -E 'resurrect|continuum'  -> save/restore bindings exist
     (NOTE: if missing, plugins didn't load — run STEP 4's install then START A FRESH tmux
     server; the config's `run` line must execute after the plugin dirs exist)
  5. Open a NEW terminal window: you should land inside tmux automatically (session "main")
  6. In that shell: tl works, `to test` creates/attaches a session named test, tmuxhelp prints the sheet
  7. tmux list-sessions after a save: press Ctrl-a Ctrl-s inside tmux -> "Tmux resurrect file saved"
     Resurrect saves to ${XDG_DATA_HOME:-~/.local/share}/tmux/resurrect/ (NOT ~/.tmux/resurrect
     unless that legacy dir already exists) — check `ls -la ~/.local/share/tmux/resurrect/last`
  8. Kill everything (tksv), reopen a terminal -> continuum should restore your session

STEP 6 RESULT — 2026-08-01 (CachyOS machine): all 8 checks PASS.
  - default-terminal xterm-kitty (kitty confirmed via $TERM)
  - quick-help menu: 8 items, { } braces present
  - resurrect bindings: prefix C-s (save) / C-r (restore)
  - autostart: fresh shell auto-created+attached session "main"
  - tl/to/tds/tmuxhelp: defined via system omz tmux plugin (aliases work)
  - resurrect save: ~/.local/share/tmux/resurrect/tmux_resurrect_*.txt + last symlink
  - continuum restore: after tksv + fresh server, session "main" auto-restored
  - p10k instant prompt: unaffected (autostart runs after omz loads, below the cache block)

STEP 7 — Report back:
  - Terminal app detected and whether default-terminal was changed
  - Whether oh-my-zsh was present or installed
  - tmux version
  - Results of every check in STEP 6 (pass/fail)
```
