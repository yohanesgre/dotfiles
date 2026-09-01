{ config, pkgs, ... }:
{
  imports = [ ../modules/hermes ]; # now also imported via common.nix; duplicate harmless

  # Host-specific overrides for desktop.
  # GUI/GPU stays pacman (nvidia/mesa, browsers, steam, DE) — do not add GUI packages here.
}
