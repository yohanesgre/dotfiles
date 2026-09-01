{ config, pkgs, ... }:
{
  # Personalize: change username/homeDirectory to your own
  home.username = "yohanes";
  home.homeDirectory = "/home/yohanes";
  home.stateVersion = "24.11";

  programs.home-manager.enable = true;

  imports = [
    ./modules/packages.nix
    ./modules/manual
    ./modules/shell/zsh.nix
    ./modules/env
    ./modules/opencode
    ./modules/engram
    ./modules/skills
    ./modules/hermes
  ];
}
