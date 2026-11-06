{ ... }:
{
  imports = [ ../modules/hermes ];

  # Host-specific overrides for desktop.
  # GUI/GPU stays pacman (nvidia/mesa, browsers, steam, DE) — do not add GUI packages here.

  # Suspend is disabled system-wide, outside home-manager:
  #   /etc/systemd/sleep.conf.d/no-suspend.conf
  #     AllowSuspend / AllowHibernation / AllowHybridSleep / AllowSuspendThenHibernate = no
  #   /etc/systemd/logind.conf.d/no-suspend.conf
  #     suspend/hibernate keys, lid switches, and idle action ignored
  #   suspend.target, sleep.target, hibernate.target, hybrid-sleep.target and
  #   suspend-then-hibernate.target are masked
  # KDE keeps AutoSuspendAction=0 in ~/.config/powerdevilrc.
  # The previous systemd *user* no-suspend inhibitor was removed: logind rejects
  # block inhibitors from user@.service (no session), so it never started.
}
