{
  config,
  lib,
  pkgs,
  ...
}:

let
  # The repo's first derivation. The crate lives in this directory next to the
  # module, the QML widget, and the shipped config.toml; only the Rust sources
  # belong in the build.
  gloss = pkgs.rustPlatform.buildRustPackage {
    pname = "gloss";
    version = "0.1.0";
    src = ./.;
    cargoLock.lockFile = ./Cargo.lock;
    # widget/ is QML, not Rust source. Drop it so it stays out of the build and
    # out of the binary's closure.
    postUnpack = "rm -rf $sourceRoot/widget || true";
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
  # file — never a session variable. gloss is also launched by the plasmoid out
  # of plasmashell's environment, which is not the shell's, so an env var would
  # not reliably arrive. Pattern matches home/modules/env.
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
            _tmp=$(mktemp)
            printf '%s\n' "$_key" > "$_tmp"
            if ! cmp -s "$_tmp" "$HOME/.config/gloss/key" 2>/dev/null; then
              $DRY_RUN_CMD mkdir -p "$HOME/.config/gloss"
              $DRY_RUN_CMD install -m 600 "$_tmp" "$HOME/.config/gloss/key"
              echo "gloss: wrote key file ~/.config/gloss/key (0600)"
            fi
            rm -f "$_tmp"
          else
            echo "gloss: GEMINI_API_KEY empty in $_toml — key file untouched" >&2
          fi
        fi
        unset _py _toml _key _tmp _base
  '';

  # The plasmoid is copied, never symlinked: KPackage needs a writable directory
  # and /nix/store is read-only. Files are enough only after the plugin index is
  # refreshed — kpackagetool6 in KF6 has no --generate-index, so the real
  # KF6/KService cache rebuild is kbuildsycoca6 --noincremental. A running
  # plasmashell picks the package up on its next start.
  #
  # Placement is deliberately NOT declarative: this flake has no plasma-manager
  # input, and one widget is not worth a new input. The manual steps, once per
  # machine:
  #   1. right-click the panel → "Add Widgets" → "Gloss". Plasma persists the
  #      applet in ~/.config/plasma-org.kde.plasma.desktop-appletsrc, not in this
  #      repo — that is why the panel position cannot drift into a Nix diff.
  #   2. hotkey: right-click the widget → "Configure Gloss" → "Keyboard
  #      Shortcuts". Accepted constraint: Plasmoid.globalShortcut fires
  #      activated(), so the widget translates the selection when it opens; a
  #      shortcut bound to arbitrary code would need C++, which this design
  #      deliberately avoids. The chosen sequence lives in Plasma's own config,
  #      next to the applet entry above.
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
    $DRY_RUN_CMD ${pkgs.kdePackages.kservice}/bin/kbuildsycoca6 --noincremental >/dev/null 2>&1 || true
  '';
}
