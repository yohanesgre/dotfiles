{ config, pkgs, ... }:
{
  imports = [ ../modules/hermes ];

  # Host-specific overrides for desktop.
  # GUI/GPU stays pacman (nvidia/mesa, browsers, steam, DE) — do not add GUI packages here.
}
