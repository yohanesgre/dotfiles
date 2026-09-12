{
  # Deliberately empty — no nixpkgs packages in the profile (policy 2026-09-07).
  # Nix here is declarative config only (dotfiles, symlinks, activation scripts).
  #
  # - System + CLI tools: pacman/CachyOS repos — declarative list in
  #   home/modules/pacman/default.nix (synced on every switch; standalone:
  #   scripts/pacman-sync.sh)
  # - Fast-moving tools (bun, rtk, codegraph, herdr): upstream
  #   installers — home/modules/upstream/default.nix
  # - engram: go install — home/modules/manual/default.nix
  # - GUI/GPU stays pacman: browsers, nvidia/mesa, DE, steam (nixGL mismatch).
}
