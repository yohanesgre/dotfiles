{
  config,
  lib,
  pkgs,
  ...
}:
let
  # Use the system Nix (daemon install) instead of pkgs.nix so GC never
  # pulls another Nix build into the store it is trying to clean.
  nixBin = "/nix/var/nix/profiles/default/bin";

  # Multi-user Nix: only root may delete store paths. yohanes has passwordless
  # sudo (scripts/setup-nopasswd-sudo.sh), so the user timer escalates with `-n`.
  gcScript = pkgs.writeShellScript "nix-gc" ''
    set -euo pipefail
    export PATH="${nixBin}:/usr/bin:/bin"
    info() { echo "nix-gc: $*"; }

    # Per-user profiles live under ~/.local/state/nix/profiles and are not
    # discovered by `nix-collect-garbage --delete-older-than`, so prune them here.
    for p in "$HOME/.local/state/nix/profiles/home-manager" \
             "$HOME/.local/state/nix/profiles/profile"; do
      if [ -e "$p" ]; then
        info "pruning generations older than 14d in $p"
        nix-env --delete-generations 14d -p "$p" || true
      fi
    done

    # Full store GC including system/root profile generations (needs root).
    info "collecting garbage (delete-older-than 14d)"
    exec sudo -n ${nixBin}/nix-collect-garbage --delete-older-than 14d
  '';
in
{
  systemd.user.services.nix-gc = {
    Unit = {
      Description = "Nix garbage collector";
    };
    Service = {
      Type = "oneshot";
      ExecStart = "${gcScript}";
    };
  };

  systemd.user.timers.nix-gc = {
    Unit = {
      Description = "Periodic Nix garbage collector";
    };
    Timer = {
      OnCalendar = "weekly";
      RandomizedDelaySec = "1h";
      Persistent = true;
      Unit = "nix-gc.service";
    };
    Install = {
      WantedBy = [ "timers.target" ];
    };
  };
}
