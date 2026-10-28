{
  config,
  lib,
  pkgs,
  ...
}:
let
  # Pin the release tag; bump it and the seccomp hash together.
  version = "0.52.1";
  image = "ghcr.io/nightly-labs/openbot:${version}";

  # The Electron sandbox needs user namespaces; Docker's default seccomp
  # profile refuses them. Fetch the profile that ships with the release.
  seccomp = pkgs.fetchurl {
    url = "https://raw.githubusercontent.com/nightly-labs/openbot/v${version}/docker/seccomp.json";
    hash = "sha256-ZlKJ5qHEEEX1UWbQsBmTySn3HfeOOjsmTzJSu44LPZ4=";
  };

  docker = "${pkgs.docker-client}/bin/docker";

  # The image ships no /usr/share/zoneinfo at all, so TZ alone only renames the
  # zone (UTC + a "Asia" label). Bind the store tzdata in and set TZ so local
  # time, log stamps and every scheduled turn use wall-clock Jakarta time.
  timezone = "Asia/Jakarta";
  tzdata = pkgs.tzdata;

  # Host omp CLI for OpenBot agents. The provider stays OpenCode/DeepSeek;
  # the agent's shell tool runs `omp` as a nested coding agent. omp uses the
  # host runtime and ~/.omp credentials inside the container.
  ompWrapper = pkgs.writeTextFile {
    name = "omp";
    executable = true;
    text = ''
      #!/bin/sh
      export PATH=/data/host-bun/bin:$PATH
      exec /data/host-bun/bin/bun /data/host-bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/dist/cli.js "$@"
    '';
  };

  # Docker starts at boot; the user manager may start first. Wait for the
  # daemon, then remove a stale container left by a crash.
  preStart = pkgs.writeShellScript "openbot-pre-start" ''
    set -eu
    until ${docker} info >/dev/null 2>&1; do
      sleep 2
    done
    ${docker} rm -f openbot >/dev/null 2>&1 || true
  '';
in
{
  # OpenBot as a self-hosted server in Docker, managed declaratively by Nix.
  #
  # The host daemon comes from pacman; only the Docker CLI used by the unit
  # comes from nixpkgs. State lives in the `openbot-data` volume, never in the
  # Nix store. The container publishes no port: it connects out to the account
  # server and providers. Use it from the desktop/phone app or openbot.run/app.
  #
  # Setup after switching:
  #   docker exec -it openbot openbot login
  #   docker exec -it openbot openbot mobile-connect
  #   docker exec openbot openbot status
  #
  # Removal: drop this import + module, `home-manager switch`, then
  #   docker volume rm openbot-data
  systemd.user.services.openbot = {
    Unit = {
      Description = "OpenBot server (Docker)";
      After = [ "network-online.target" ];
      Wants = [ "network-online.target" ];
    };

    Service = {
      ExecStartPre = "${preStart}";
      # `omp` at /usr/local/bin is the host omp CLI. OpenBot agents use their
      # own provider (OpenCode/DeepSeek) and shell out to `omp` for host work.
      # Do not mount ~/.pi: the managed Pi runtime keeps its account state in
      # the container's /data/.pi and the host mount makes Pi exit (1).
      ExecStart =
        "${docker} run --rm --name openbot"
        + " --security-opt seccomp=${seccomp}"
        + " --security-opt no-new-privileges:true"
        + " --shm-size 1g --stop-timeout 60"
        + " --log-opt max-size=10m --log-opt max-file=3"
        + " -e TZ=${timezone}"
        + " -v ${tzdata}/share/zoneinfo:/usr/share/zoneinfo:ro"
        + " -v openbot-data:/data"
        + " -v ${config.home.homeDirectory}/.bun:/data/host-bun:ro"
        + " -v ${config.home.homeDirectory}/.omp:/data/.omp"
        + " -v ${config.home.homeDirectory}/projects:/data/projects"
        # Skills: ~/.agents/skills holds one link per skill, and those links are
        # ABSOLUTE host paths ($HOME/projects/dotfiles/config/skills/<name>).
        # Mounting ~/.agents alone leaves them dangling inside the container, so
        # the repo must also appear at the same absolute path the links name.
        + " -v ${config.home.homeDirectory}/.agents:/data/.agents:ro"
        + " -v ${config.home.homeDirectory}/projects:${config.home.homeDirectory}/projects"
        + " -v ${ompWrapper}:/usr/local/bin/omp:ro"
        + " ${image}";
      ExecStop = "-${docker} stop -t 60 openbot";
      Restart = "always";
      RestartSec = 10;
      TimeoutStartSec = 600;
      TimeoutStopSec = 120;
    };

    Install.WantedBy = [ "default.target" ];
  };
}
