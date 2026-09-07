# PATH priority — Nix/declarative-managed binaries win over pacman system ones.
# Order (highest first):
#   1. HM profile            — home-manager + HM machinery (~/.nix-profile)
#   2. Nix daemon profile    — /nix/var/nix/profiles/default
#   3. Upstream installers   — managed by Nix activation scripts
#                              (~/.bun bun, ~/.local/bin rtk/cbm/herdr/engram, ~/go/bin)
#   4. pacman/CachyOS system — /usr/bin and everything else
# pacman may provide the same tool (e.g. bun) — the Nix/upstream copy above
# always shadows it. typeset -U keeps entries unique.
typeset -U path PATH
path=(
  "$HOME/.nix-profile/bin"
  /nix/var/nix/profiles/default/bin
  "$HOME/.bun/bin"
  "$HOME/.local/bin"
  "$HOME/go/bin"
  $path
)
export PATH
