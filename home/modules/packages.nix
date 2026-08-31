{ config, lib, pkgs, ... }:
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
  # GUI/GPU stays pacman: browsers, nvidia/mesa, DE, steam — not in Nix (avoid nixGL mismatch).

  home.activation.bunShim = lib.hm.dag.entryAfter ["writeBoundary"] ''
    mkdir -p "$HOME/.bun/bin" "$HOME/.local/bin"
    ln -sf "$HOME/.nix-profile/bin/bun" "$HOME/.bun/bin/bun"
    ln -sf "$HOME/.nix-profile/bin/bunx" "$HOME/.bun/bin/bunx"
    if [ -x "$HOME/.nix-profile/bin/node" ]; then
      ln -sf "$HOME/.nix-profile/bin/node" "$HOME/.local/bin/node"
      ln -sf "$HOME/.nix-profile/bin/npm" "$HOME/.local/bin/npm"
      ln -sf "$HOME/.nix-profile/bin/npx" "$HOME/.local/bin/npx"
    fi
  '';
}
