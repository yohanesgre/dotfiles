{ config, lib, pkgs, paseoPkgs, ... }:
{
  # Paseo — coding-agent control plane (daemon + CLI).
  #
  # Deliberate exception to the "no nixpkgs packages in the profile" policy in
  # home/modules/packages.nix: nixpkgs carries `paseo`, so the binary comes from
  # the Nix store instead of a bun global install. The flake pins the nixpkgs
  # revision that has it (`nixpkgs-paseo`) so the main nixpkgs does not move.
  #
  # Version note: nixpkgs has 0.12.0; the bun/upstream install was 0.13.2.
  # Paseo's app/daemon protocol is what matters; verify the phone app connects
  # before relying on the newer features.
  #
  # State and secrets stay outside the store:
  #   ~/.paseo/                      daemon state, sessions, artifacts
  #   ~/.config/paseo/paseo.env      PASEO_PASSWORD, listen/hostname/public URL
  #
  # Removal: delete this import + module, `home-manager switch`, then
  # `nix-collect-garbage -d`. State dirs above remain until deleted.
  home.packages = [ paseoPkgs.paseo ];

  systemd.user.services.paseo = {
    Unit = {
      Description = "Paseo daemon (coding-agent control plane)";
      After = [ "network-online.target" ];
      Wants = [ "network-online.target" ];
    };

    Service = {
      ExecStart = "${paseoPkgs.paseo}/bin/paseo daemon run --home %h/.paseo";
      EnvironmentFile = "%h/.config/paseo/paseo.env";
      # Agents launched by Paseo resolve here: upstream CLIs first, then nix.
      Environment = [
        "PATH=%h/.bun/bin:%h/.local/bin:%h/.nix-profile/bin:/usr/local/bin:/usr/bin:/bin"
      ];
      Restart = "on-failure";
      RestartSec = 3;
      TimeoutStopSec = 30;

      # Modest hardening. This is a package/runtime boundary, not a sandbox:
      # the agents Paseo launches still need $HOME (repos, credentials, agent
      # configs), so ProtectHome stays off. For real isolation, run the daemon
      # in a container or under a dedicated user.
      NoNewPrivileges = true;          # blocks setuid escalation (sudo) inside agent shells
      PrivateTmp = true;               # hides shared /tmp (may break GUI/X11 tools)
      ProtectSystem = "full";          # /usr, /boot, /etc read-only
      ProtectKernelTunables = true;
      ProtectKernelModules = true;
      ProtectControlGroups = true;
      RestrictSUIDSGID = true;
      LockPersonality = true;
      RestrictAddressFamilies = [
        "AF_UNIX"
        "AF_INET"
        "AF_INET6"
        "AF_NETLINK"
      ];
    };

    Install.WantedBy = [ "default.target" ];
  };
}
