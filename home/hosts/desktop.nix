{ config, pkgs, ... }:
{
  imports = [ ../modules/hermes ];

  # Host-specific overrides for desktop.
  # GUI/GPU stays pacman (nvidia/mesa, browsers, steam, DE) — do not add GUI packages here.

  # ── Luvus Web published through a Cloudflare Tunnel (2026-10-12) ──────────
  # Desktop only: this box publishes its own Luvus server to a browser.
  #
  #   browser ─https─> luvus.yohanesgre.com                (proxied CNAME)
  #     └─ Cloudflare edge, Access app "Luvus Web"         (one-time PIN to the
  #        owner address only, 24h session — the gate for --control below)
  #        └─ Tunnel "luvus" 93f311c4-c6b6-4413-8aad-36e638016684 (remotely
  #           managed; ingress luvus.yohanesgre.com -> http://127.0.0.1:4174,
  #           catch-all http_status:404)
  #           └─ `luvus web` bridge on 127.0.0.1:4174      (loopback only)
  #              └─ Luvus server, session "default"
  #
  # Only the bridge and the connector run on this machine. The Cloudflare side
  # (tunnel, DNS record, Access app, One-time PIN IdP) is account state, not
  # repo state — the exact provisioning commands are recorded in
  # docs/configuration-changelog.md (2026-10-12). The tunnel token is a
  # credential: it is never written here, `cf tunnels run` holds it.
  #
  # `--control` lets the browser type into PTYs, which is why Access is
  # mandatory. `--public-url`/`--origin` pin the only host name the bridge
  # answers to, so DNS rebinding cannot reach it.
  #
  # Pairing is per bridge process, so a restart (boot, hm-switch, crash) needs a
  # fresh one-use link: `bash scripts/luvus-pair.sh` mints one from the journal
  # (`--current` re-reads the current link instead of revoking paired browsers).
  systemd.user.services = {
    # Ensures a server exists after boot. Type=oneshot + RemainAfterExit keeps
    # this unit from owning the daemonised server: the unit must never be able
    # to SIGTERM panes, and `luvus server start` is a no-op when one runs.
    luvus-server = {
      Unit = {
        Description = "Luvus server — panes, agents and persistence for the agent multiplexer";
        After = [ "network.target" ];
      };
      Service = {
        Type = "oneshot";
        RemainAfterExit = true;
        ExecStart = "%h/.local/bin/luvus server start";
        TimeoutStartSec = 30;
        KillMode = "process";
      };
      Install.WantedBy = [ "default.target" ];
    };

    luvus-web = {
      Unit = {
        Description = "Luvus Web — browser client bridge (loopback HTTP/WS, control enabled)";
        Requires = [ "luvus-server.service" ];
        After = [
          "luvus-server.service"
          "network-online.target"
        ];
        Wants = [ "network-online.target" ];
      };
      Service = {
        ExecStart = "%h/.local/bin/luvus web --control --no-open --port 4174 --public-url https://luvus.yohanesgre.com --origin https://luvus.yohanesgre.com";
        Restart = "on-failure";
        RestartSec = 3;
        KillMode = "process";
      };
      Install.WantedBy = [ "default.target" ];
    };

    # `cf tunnels run` (cf CLI) downloads and drives its own cloudflared, so no
    # cloudflared package is needed; the account id disambiguates the two
    # accounts this login can reach.
    luvus-tunnel = {
      Unit = {
        Description = "Cloudflare Tunnel 'luvus' — public HTTPS endpoint for the Luvus Web bridge";
        Wants = [
          "luvus-web.service"
          "network-online.target"
        ];
        After = [
          "luvus-web.service"
          "network-online.target"
        ];
      };
      Service = {
        ExecStart = "%h/.bun/bin/cf tunnels run luvus --log-level info";
        Environment = [ "CLOUDFLARE_ACCOUNT_ID=8e10f6d35f35bc539a885f0fa9c7039f" ];
        Restart = "always";
        RestartSec = 5;
      };
      Install.WantedBy = [ "default.target" ];
    };

    # Paseo daemon (home/modules/paseo) published at paseo.yohanesgre.com
    # through the remotely managed "paseo" tunnel
    # (7df182c4-9b53-4b03-85d8-922ae5a98f30). Ingress + DNS are account
    # state; the daemon's PASEO_PASSWORD is the auth gate.
    paseo-tunnel = {
      Unit = {
        Description = "Cloudflare Tunnel 'paseo' — public HTTPS endpoint for the Paseo daemon";
        Wants = [
          "paseo.service"
          "network-online.target"
        ];
        After = [
          "paseo.service"
          "network-online.target"
        ];
      };
      Service = {
        ExecStart = "%h/.bun/bin/cf tunnels run paseo --log-level info";
        Environment = [ "CLOUDFLARE_ACCOUNT_ID=8e10f6d35f35bc539a885f0fa9c7039f" ];
        Restart = "always";
        RestartSec = 5;
      };
      Install.WantedBy = [ "default.target" ];
    };
  };
}
