{
  config,
  lib,
  pkgs,
  ...
}:
{
  # browser-use keeps its runtime state in config.json and rewrites it when the
  # tool migrates or updates a profile. A /nix/store symlink would be replaced
  # by a real file on such a write, so copy instead (cmp-guarded, dotfiles win),
  # same rationale as opencodeSyncCliJson for cli.json.
  home.activation.browserUseSyncConfig = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    SRC="$HOME/projects/dotfiles/config/browseruse/config.json"
    DST="$HOME/.config/browseruse/config.json"
    if [ -f "$SRC" ] && { [ ! -f "$DST" ] || ! cmp -s "$SRC" "$DST"; }; then
      $DRY_RUN_CMD mkdir -p "$HOME/.config/browseruse"
      $DRY_RUN_CMD install -m 644 "$SRC" "$DST"
      echo "browser-use: synced config.json"
    fi
  '';

  # Chrome desktop overrides: point the launcher at a stable remote-debugging
  # port + profile dir so browser-use can attach over CDP. Rendered from the
  # system desktop files (quiet when absent) rather than symlinked, so a distro
  # update to the source is picked up on the next switch.
  home.activation.browserUseChromeDesktop = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    _home="${config.home.homeDirectory}"
    for _n in google-chrome com.google.Chrome; do
      _src="/usr/share/applications/$_n.desktop"
      _dst="$HOME/.local/share/applications/$_n.desktop"
      if [ -f "$_src" ]; then
        $DRY_RUN_CMD mkdir -p "$HOME/.local/share/applications"
        _tmp=$(mktemp)
        sed "s|^Exec=/usr/bin/google-chrome-stable|Exec=/usr/bin/google-chrome-stable --remote-debugging-port=9223 --user-data-dir=$_home/.config/google-chrome|" "$_src" > "$_tmp"
        if ! cmp -s "$_tmp" "$_dst" 2>/dev/null; then
          $DRY_RUN_CMD install -m 644 "$_tmp" "$_dst"
          echo "browser-use: rendered $_n.desktop override"
        fi
        rm -f "$_tmp"
      fi
    done
    unset _home _n _src _dst _tmp
    if command -v update-desktop-database >/dev/null 2>&1; then
      $DRY_RUN_CMD update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
    fi
  '';
}
