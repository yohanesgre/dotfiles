{ pkgs, ... }:
{
  home.packages = with pkgs; [
    git
    curl
    wget
    jq
    ripgrep
    fd
    fzf
    bat
    eza
    zoxide
    bun
    nodejs_22
    go
    neovim
    tmux
    codebase-memory-mcp
    rtk
    opencode
    herdr
  ];

  # engram not in nixpkgs: kept manual via home/modules/manual (go install).
  # omp via flake inputs.omp (programs.omp), not nixpkgs.
  # GUI/GPU stays pacman: browsers, nvidia/mesa, DE, steam — not in Nix (avoid nixGL mismatch).
}
