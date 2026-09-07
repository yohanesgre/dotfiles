{ config, lib, ... }:
{
  # LazyVim — config from repo via out-of-store symlink (edits in
  # config/nvim apply instantly, no switch needed). Binary comes from
  # pacman (home/modules/pacman). lazy.nvim + plugins bootstrap to
  # ~/.local/share/nvim on first `nvim` launch (runtime, not declarative).
  xdg.configFile."nvim".source =
    config.lib.file.mkOutOfStoreSymlink "${config.home.homeDirectory}/projects/dotfiles/config/nvim";
}
