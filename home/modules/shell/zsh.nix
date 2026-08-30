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

    initExtraFirst = ''
      # Powerlevel10k instant prompt — must stay near top of zshrc.
      if [[ -r "''${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-''${(%):-%n}.zsh" ]]; then
        source "''${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-''${(%):-%n}.zsh"
      fi

      # oh-my-zsh tmux plugin settings (must be before omz loads)
      ZSH_TMUX_AUTOSTART=false
      ZSH_TMUX_AUTOQUIT=false
      ZSH_TMUX_DEFAULT_SESSION_NAME=main
    '';

    initExtra = builtins.readFile ../../../config/zsh/extra.zsh;
  };

  home.file.".p10k.zsh".source = ../../../config/p10k.zsh;
}
