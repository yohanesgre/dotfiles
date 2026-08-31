{ config, pkgs, lib, ... }:
{
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;

    oh-my-zsh = {
      enable = true;
      plugins = [ "git" "fzf" "extract" "tmux" ];
      custom = "$HOME/.oh-my-zsh/custom";
    };

    initContent = lib.mkMerge [
      (lib.mkBefore ''
        # Powerlevel10k instant prompt — must stay near top of zshrc.
        if [[ -r "''${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-''${(%):-%n}.zsh" ]]; then
          source "''${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-''${(%):-%n}.zsh"
        fi

        # oh-my-zsh tmux plugin settings (must be before omz loads)
        ZSH_TMUX_AUTOSTART=false
        ZSH_TMUX_AUTOQUIT=false
        ZSH_TMUX_DEFAULT_SESSION_NAME=main
      '')
      (builtins.readFile ../../../config/zsh/extra.zsh)
    ];
  };

  home.file.".p10k.zsh".source = ../../../config/p10k.zsh;

  # Force zsh as default login shell on every machine (CachyOS desktop/laptop/dell-xps13)
  # - ensures /usr/bin/zsh and nix zsh are in /etc/shells
  # - chsh to zsh if current shell is not zsh
  home.activation.forceZshShell = lib.hm.dag.entryAfter ["writeBoundary"] ''
    ZSH_BIN="${pkgs.zsh}/bin/zsh"
    SYS_ZSH="/usr/bin/zsh"
    # ensure zsh binaries are in /etc/shells (needs sudo, best-effort)
    for bin in "$ZSH_BIN" "$SYS_ZSH" "/bin/zsh"; do
      if [ -x "$bin" ] && ! grep -qxF "$bin" /etc/shells 2>/dev/null; then
        echo "→ adding $bin to /etc/shells"
        if sudo -n sh -c "echo '$bin' >> /etc/shells" 2>/dev/null; then
          echo "  ✓ added via sudo -n"
        elif command -v pkexec >/dev/null 2>&1; then
          pkexec sh -c "echo '$bin' >> /etc/shells" 2>/dev/null && echo "  ✓ added via pkexec" || echo "  ⚠ need sudo to add $bin to /etc/shells (run: sudo sh -c 'echo $bin >> /etc/shells')"
        else
          echo "  ⚠ need sudo: sudo sh -c 'echo $bin >> /etc/shells'"
        fi
      fi
    done

    CURRENT_SHELL="$(/usr/bin/getent passwd "$USER" 2>/dev/null | cut -d: -f7 || getent passwd "$USER" 2>/dev/null | cut -d: -f7 || echo "$SHELL")"
    TARGET_SHELL="$SYS_ZSH"
    # prefer nix zsh if it is already in /etc/shells, else sys zsh
    if grep -qxF "$ZSH_BIN" /etc/shells 2>/dev/null; then
      TARGET_SHELL="$ZSH_BIN"
    fi

    if [ "$CURRENT_SHELL" != "$TARGET_SHELL" ] && [ "$CURRENT_SHELL" != "$ZSH_BIN" ] && [ "$CURRENT_SHELL" != "$SYS_ZSH" ]; then
      echo "→ forcing default shell: $CURRENT_SHELL -> $TARGET_SHELL"
      if chsh -s "$TARGET_SHELL" 2>/dev/null; then
        echo "  ✓ chsh succeeded"
      elif sudo -n chsh -s "$TARGET_SHELL" "$USER" 2>/dev/null; then
        echo "  ✓ sudo chsh succeeded"
      elif command -v pkexec >/dev/null 2>&1 && pkexec chsh -s "$TARGET_SHELL" "$USER" 2>/dev/null; then
        echo "  ✓ pkexec chsh succeeded"
      else
        echo "  ⚠ chsh failed — run manually: chsh -s $TARGET_SHELL  (or sudo chsh -s $TARGET_SHELL $USER)"
      fi
    else
      echo "→ shell already zsh ($CURRENT_SHELL)"
    fi
  '';
}
