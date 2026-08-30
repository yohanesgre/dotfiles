{ config, lib, ... }:
{
  home.file.".agents/skills".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/projects/dotfiles/config/skills";
}
