{ config, pkgs, ... }:
{
  xdg.configFile."hermes".source = ../../../config/hermes;
  xdg.configFile."hermes".recursive = true;

  systemd.user.services.hermes-config-sync = {
    Unit.Description = "Sync Hermes configs from live to dotfiles (every 5 min)";
    Service = {
      Type = "oneshot";
      ExecStart = "/usr/bin/python3 %h/projects/dotfiles/scripts/sync-hermes-config.py";
      StandardOutput = "journal";
      StandardError = "journal";
    };
  };

  systemd.user.timers.hermes-config-sync = {
    Unit.Description = "Hermes config sync timer (every 5 min)";
    Timer = {
      OnCalendar = "*:0/5";
      Persistent = true;
    };
    Install.WantedBy = [ "timers.target" ];
  };
}
