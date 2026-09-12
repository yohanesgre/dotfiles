{ config, lib, ... }:
let
  home = config.home.homeDirectory;
  # committed skills = every directory under config/skills (sources.json is a file)
  committed = lib.filterAttrs (_: type: type == "directory") (builtins.readDir ../../config/skills);
in
{
  # Committed skills appear as individual out-of-store symlinks inside the real,
  # harness-agnostic global root ~/.agents/skills. Keeping that root a real directory
  # lets `npx skills` install externalized skills (sources.json scope=project) as
  # siblings, without ever writing into the dotfiles repo (old layout made the whole
  # dir a symlink to config/skills, so a global install mutated the repo).
  home.file = lib.mapAttrs' (
    name: _:
    lib.nameValuePair ".agents/skills/${name}" {
      source = config.lib.file.mkOutOfStoreSymlink "${home}/projects/dotfiles/config/skills/${name}";
    }
  ) committed;

  # Externalized skills install globally on every switch via `npx skills`
  # (-a universal from $HOME -> ~/.agents/skills). Upstream owns their content, dotfiles owns the
  # set. Idempotent (existing SKILL.md dirs skipped); network-dependent, non-fatal on
  # failure (mirrors the upstream installers).
  home.activation.skillsSyncGlobal = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
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
