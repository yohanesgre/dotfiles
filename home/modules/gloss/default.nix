{
  lib,
  pkgs,
  ...
}:

let
  # The repo's first derivation. The crate lives in this directory next to the
  # module, the QML widget, and the shipped config.toml; only the Rust inputs
  # enter the build, so a widget edit does not rehash src and recompile.
  gloss = pkgs.rustPlatform.buildRustPackage {
    pname = "gloss";
    version = (lib.importTOML ./Cargo.toml).package.version;
    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [
        ./Cargo.toml
        ./Cargo.lock
        ./src
        ./tests
      ];
    };
    cargoLock.lockFile = ./Cargo.lock;
    meta = {
      description = "Quick translation and word study";
      license = lib.licenses.mit;
      mainProgram = "gloss";
    };
  };
in
{
  home.packages = [ gloss ];

  xdg.configFile."gloss/config.toml".source = ./config.toml;

  # The API key is read from the gitignored .env.toml and written here as a 0600
  # file — the file is the reliable path. home/modules/env's loadDotEnv also
  # imports every top-level .env.toml key into the systemd user environment, so
  # once GEMINI_API_KEY exists it is likely an env var too; gloss does not depend
  # on that. gloss is also launched by the plasmoid out of plasmashell's
  # environment, which is not the shell's, so an env var would not reliably
  # arrive. Pattern matches home/modules/env.
  home.activation.writeGlossKey = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        _py=${pkgs.python3}/bin/python3
        if ! [ -x "$_py" ]; then _py=python3; fi

        _toml=""
        for _base in "$HOME/projects/dotfiles" "$HOME"; do
          if [ -f "$_base/.env.toml" ]; then _toml="$_base/.env.toml"; break; fi
        done

        if [ -n "$_toml" ]; then
          _key=$("$_py" - "$_toml" 2>/dev/null <<'PY'
    import sys, tomllib
    try:
        data = tomllib.load(open(sys.argv[1], "rb"))
    except Exception:
        sys.exit(0)
    print(data.get("GEMINI_API_KEY", ""))
    PY
    )
          if [ -n "$_key" ]; then
            # Temp file lives in the destination dir and is uniquely named: no
            # global EXIT trap (a later activation block's trap would overwrite
            # it, and the shared shell namespace can unset the variable it
            # references), and mktemp is 0600 so the key is never readable
            # mid-flight — a leftover on the failure path stays 0600 in the
            # user's own config dir instead of world-traversable /tmp.
            $DRY_RUN_CMD mkdir -p "$HOME/.config/gloss"
            _gloss_tmp="$(mktemp "$HOME/.config/gloss/.key.XXXXXX")"
            printf '%s\n' "$_key" > "$_gloss_tmp"
            # Repair a world-readable key file even when its content matches.
            $DRY_RUN_CMD chmod 600 "$HOME/.config/gloss/key" 2>/dev/null || true
            if ! cmp -s "$_gloss_tmp" "$HOME/.config/gloss/key" 2>/dev/null; then
              $DRY_RUN_CMD install -m 600 "$_gloss_tmp" "$HOME/.config/gloss/key"
              echo "gloss: wrote key file ~/.config/gloss/key (0600)"
            fi
            rm -f "$_gloss_tmp"
          else
            echo "gloss: GEMINI_API_KEY empty in $_toml — key file untouched" >&2
          fi
        fi
        unset _py _toml _key _base
  '';

  # The plasmoid is copied, never symlinked: KPackage needs a writable directory
  # and /nix/store is read-only. No index step is needed — Plasma 6 discovers
  # applets by scanning ~/.local/share/plasma/plasmoids/ (kpackagetool6
  # -t Plasma/Applet --list reads that directory directly; KSycoca does not
  # index applets), and a running plasmashell picks the package up on its next
  # start. The plan's original kpackagetool6 --generate-index does not exist in
  # KF6.
  #
  # Placement is deliberately NOT declarative: this flake has no plasma-manager
  # input, and one widget is not worth a new input. The manual steps, once per
  # machine:
  #   1. right-click the panel → "Add Widgets" → "Gloss". Plasma persists the
  #      applet in ~/.config/plasma-org.kde.plasma.desktop-appletsrc, not in this
  #      repo — that is why the panel position cannot drift into a Nix diff.
  #   2. hotkey: right-click the widget → "Configure Gloss" → "Keyboard
  #      Shortcuts". The shell injects that page for every applet
  #      (plasma-desktop's AppletConfiguration.qml adds ConfigurationShortcuts
  #      .qml to its global config model); it writes Plasmoid.globalShortcut,
  #      which main.qml defaults to Meta+Ctrl+G while it is empty. The shortcut
  #      only fires Plasmoid.activated(), which toggles the popup — the widget
  #      cannot bind code to it, so it translates the selection when the popup
  #      expands. The chosen sequence lives in Plasma's own config, next to the
  #      applet entry above.
  home.activation.installGlossPlasmoid = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    dest="$HOME/.local/share/plasma/plasmoids/org.gloss.translator"
    src="${./widget}"
    if ! diff -rq "$src" "$dest" >/dev/null 2>&1; then
      $DRY_RUN_CMD chmod -R u+w "$dest" 2>/dev/null || true
      $DRY_RUN_CMD rm -rf "$dest"
      $DRY_RUN_CMD mkdir -p "$(dirname "$dest")"
      $DRY_RUN_CMD cp -r "$src" "$dest"
      $DRY_RUN_CMD chmod -R u+w "$dest"
      echo "gloss: installed plasmoid org.gloss.translator"
    fi
  '';
}
