{ config, pkgs, ... }:
{
  # fastfetch: fetch sistem saat buka terminal. Paket dari pacman (lihat
  # modules/pacman), config dikelola di sini biar ikut hm-switch.
  xdg.configFile."fastfetch/config.jsonc".source = ../../../config/fastfetch/config.jsonc;
  xdg.configFile."fastfetch/logo.png".source = ../../../config/fastfetch/logo.png;
  xdg.configFile."fastfetch/penrose-sky-wp.png".source = ../../../config/fastfetch/penrose-sky-wp.png;
}
