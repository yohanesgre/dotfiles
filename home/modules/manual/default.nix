{
  config,
  lib,
  pkgs,
  ...
}:
{
  home.activation.manualInstall = lib.hm.dag.entryAfter [ "installPackages" ] ''
    set -u

    warn() { echo "manualInstall: $*" >&2; }
    info() { echo "manualInstall: $*"; }

    # bun / codegraph / rtk / icm / luvus / omp / jev-mcp via upstream installers
    # (home/modules/upstream); opencode via bun (home/modules/opencode)

    # never block switch
    true
  '';
}
