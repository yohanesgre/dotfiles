{ lib, pkgs, ... }:
let
  # committed skills = every directory under config/skills (sources.json is a file)
  committed = lib.filterAttrs (_: type: type == "directory") (
    builtins.readDir ../../../config/skills
  );
  skillNames = builtins.attrNames committed;
  # shell-quoted list, interpolated into the activation script
  quotedNames = lib.concatMapStringsSep " " (n: "'${n}'") skillNames;
in
{
  # ~/.agents/skills MUST be a real directory — never a store/repo symlink.
  # Why (bug fixed 2026-09-12): home.file targets under a symlinked root made
  # home-manager write THROUGH the link into the repo; combined with `-b backup`
  # it renamed every committed skill config/skills/<name> -> <name>.backup and
  # left circular self-symlinks. So the root is normalized BEFORE the file-writing
  # phase, and committed skills are linked as per-skill out-of-store symlinks
  # AFTER it — never via home.file.
  home.activation.skillsRoot = lib.hm.dag.entryBefore [ "writeBoundary" ] ''
    ROOT="$HOME/.agents/skills"
    if [ -L "$ROOT" ]; then
      rm -- "$ROOT"
    elif [ -e "$ROOT" ] && [ ! -d "$ROOT" ]; then
      rm -rf -- "$ROOT"
    fi
    mkdir -p "$ROOT"
  '';

  home.activation.skillsLinks = lib.hm.dag.entryAfter [ "writeBoundary" "skillsRoot" ] ''
    ROOT="$HOME/.agents/skills"
    SRC="$HOME/projects/dotfiles/config/skills"
    for name in ${quotedNames}; do
      [ -d "$SRC/$name" ] || continue
      # refresh committed skills' links; never clobber a real (npx-installed) dir
      if [ -L "$ROOT/$name" ] || [ ! -e "$ROOT/$name" ]; then
        ln -sfn "$SRC/$name" "$ROOT/$name"
      fi
    done
  '';

  home.activation.goalH2HDependencies =
    lib.hm.dag.entryAfter [ "writeBoundary" "skillsLinks" "upstreamInstall" ]
      ''
        SRC="$HOME/projects/dotfiles/config/skills/goal/runtime"
        BUN_BIN="$HOME/.bun/bin/bun"
        for required in package.json bun.lock command-center.ts; do
          if [ ! -f "$SRC/$required" ]; then
            echo "goal H2H: required runtime source is missing: $SRC/$required" >&2
            exit 1
          fi
        done
        EFFECTIVE="$HOME/.agents/skills/goal/runtime"
        if ! EFFECTIVE_REAL=$(${pkgs.coreutils}/bin/realpath -e "$EFFECTIVE"); then
          echo "goal H2H: installed runtime is missing: $EFFECTIVE" >&2
          exit 1
        fi
        SOURCE_REAL=$(${pkgs.coreutils}/bin/realpath -e "$SRC")
        if [ "$EFFECTIVE_REAL" != "$SOURCE_REAL" ]; then
          echo "goal H2H: installed runtime $EFFECTIVE_REAL differs from intended source $SOURCE_REAL; preserved skill directories were not overwritten" >&2
          exit 1
        fi
        if [ ! -x "$BUN_BIN" ]; then
          echo "goal H2H: bun is required to install pinned runtime dependencies" >&2
          exit 1
        fi
        (cd "$SRC" && "$BUN_BIN" install --frozen-lockfile --ignore-scripts)
      '';

  # Externalized skills install globally on every switch via `npx skills`
  # (-a universal from $HOME -> ~/.agents/skills). Upstream owns their content,
  # dotfiles owns the set. Idempotent (existing SKILL.md dirs skipped);
  # network-dependent, non-fatal on failure. Runs after the root is a real dir.
  home.activation.skillsSyncGlobal = lib.hm.dag.entryAfter [ "writeBoundary" "skillsLinks" ] ''
    SYNC="$HOME/projects/dotfiles/scripts/skills-sync.sh"
    if [ -x "$SYNC" ]; then
      echo "skills: syncing externalized skills globally (npx skills -> ~/.agents/skills)..."
      if bash "$SYNC" --global; then
        echo "skills: global sync done"
        if ! bash "$SYNC" --global --check >/dev/null 2>&1; then
          echo "skills: WARNING — externalized skills still missing; run: bash scripts/skills-sync.sh --global --check"
        fi
      else
        echo "skills: global sync failed (continuing)"
      fi
    fi
  '';
}
