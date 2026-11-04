{ config, pkgs, ... }:
{
  imports = [ ../modules/hermes ];

  # Host-specific overrides for desktop.
  # GUI/GPU stays pacman (nvidia/mesa, browsers, steam, DE) — do not add GUI packages here.

  systemd.user.services = {
    # SSH-reachable box: never suspend. systemd-inhibit holds a logind "sleep"
    # block inhibitor for as long as it runs, so every suspend request fails —
    # PowerDevil, `systemctl suspend`, logind/loginctl, keys. /etc is already
    # key/lid/idle-ignore, but this also covers explicit requests. For a
    # one-off: `systemctl --user stop no-suspend`, suspend, then `start` it.
    no-suspend = {
      Unit.Description = "Block all suspend/hibernate — desktop must stay reachable over SSH";
      Service = {
        # --what=sleep covers suspend, hibernate, hybrid-sleep, suspend-then-hibernate.
        ExecStart = "/usr/bin/systemd-inhibit --what=sleep --mode=block --who=homestation --why=remote-SSH /usr/bin/sleep infinity";
        Restart = "always";
        RestartSec = 1;
      };
      Install.WantedBy = [ "default.target" ];
    };
  };
}
