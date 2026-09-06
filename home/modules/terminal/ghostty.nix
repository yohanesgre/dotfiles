{ config, pkgs, ... }:
{
  # Prereq powerlevel10k yang diown nix:
  # - MesloLGS NF (Nerd Font rekomendasi p10k) — pacman di CachyOS juga punya,
  #   tapi nix bawa sendiri biar hm-switch --remote di mesin mana pun langsung jalan.
  home.packages = with pkgs; [ meslo-lgs-nf ];

  # Bikin font nix-profile kebaca fontconfig di non-NixOS (tanpa ini fc-list
  # tidak melihat ~/.nix-profile/share/fonts).
  fonts.fontconfig.enable = true;

  # Ghostty: set Nerd Font sbg font utama (repo ini belum manage ghostty sebelumnya,
  # jadi file ini baru — tidak menimpa config user yang ada).
  xdg.configFile."ghostty/config".source = ../../../config/ghostty/config;
}
