{ config, pkgs, ... }:
{
  xdg.configFile."opencode".source = ../../../config/opencode;
  xdg.configFile."opencode".recursive = true;

  home.packages = with pkgs; [
    bun
  ];
}
