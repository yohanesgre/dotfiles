{
  config,
  pkgs,
  lib,
  ...
}:
{
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;

    oh-my-zsh = {
      enable = true;
      theme = "powerlevel10k";
      plugins = [
        "git"
        "fzf"
        "extract"
      ];
      custom = "$HOME/.oh-my-zsh/custom";
    };

    shellAliases = {
      hm = "$HOME/projects/dotfiles/scripts/hm-switch.sh";
      hm-remote = "$HOME/projects/dotfiles/scripts/hm-switch.sh --remote";
      hm-check = "nix flake check --no-build";
      hm-fmt = "nix fmt";
      hm-validate = "bash $HOME/projects/dotfiles/scripts/validate.sh";
    };

    # powerlevel10k from pacman (zsh-theme-powerlevel10k) — no nixpkgs theme
    initContent = lib.mkMerge [
      (lib.mkBefore ''
        # Powerlevel10k instant prompt — must stay near top of zshrc.
        if [[ -r "''${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-''${(%):-%n}.zsh" ]]; then
          source "''${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-''${(%):-%n}.zsh"
        fi

        # Separate completion dump for HM's oh-my-zsh. The CachyOS oh-my-zsh
        # sourced later (config/zsh/extra.zsh) stamps the same $ZSH_COMPDUMP with
        # a different fpath, forcing compinit to rebuild the dump every shell.
        export ZSH_COMPDUMP="''${ZDOTDIR:-$HOME}/.zcompdump-hm-''${HOST%%.*}-''${ZSH_VERSION}"

        # PATH priority (Nix/upstream > pacman) — see config/zsh/path.zsh
        ${builtins.readFile ../../../config/zsh/path.zsh}
      '')
      (builtins.readFile ../../../config/zsh/extra.zsh)
    ];
  };

  home.file.".p10k.zsh".source = ../../../config/p10k.zsh;

  # p10k theme from pacman package — out-of-store symlink (follows pacman updates)
  home.file.".oh-my-zsh/custom/themes/powerlevel10k.zsh-theme".source =
    config.lib.file.mkOutOfStoreSymlink "/usr/share/zsh-theme-powerlevel10k/powerlevel10k.zsh-theme";

  # Force zsh as default login shell on every machine (CachyOS desktop/laptop/dell-xps13)
  # - ensures /usr/bin/zsh (pacman) is in /etc/shells
  # - chsh to zsh if current shell is not zsh
  home.activation.forceZshShell = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    ZSH_BIN="/usr/bin/zsh"
    SYS_ZSH="/usr/bin/zsh"
    # ensure zsh binaries are in /etc/shells (needs sudo, best-effort)
    for bin in "$SYS_ZSH" "/bin/zsh"; do
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

    if [ "$CURRENT_SHELL" != "$TARGET_SHELL" ] && [ "$CURRENT_SHELL" != "$SYS_ZSH" ]; then
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
