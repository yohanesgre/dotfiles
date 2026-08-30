{ config, pkgs, ... }:
{
  home.file.".engram/config.json".source = ../../../config/engram/config.json;
}
