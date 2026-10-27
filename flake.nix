{
  description = "yohanes dotfiles - home-manager standalone (CachyOS x86_64-linux)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # Paseo is not in the flake's pinned nixpkgs; pin the nixpkgs revision
    # that carries `paseo` (0.12.0) without moving the main nixpkgs.
    nixpkgs-paseo.url = "github:NixOS/nixpkgs/d3b13ad75cc492690728f9307e443dec9ef9a20e";
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      nixpkgs-paseo,
      ...
    }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      mkHome =
        hostFile:
        home-manager.lib.homeManagerConfiguration {
          inherit pkgs;
          extraSpecialArgs = {
            paseoPkgs = nixpkgs-paseo.legacyPackages.${system};
          };
          modules = [
            ./home/common.nix
            hostFile
          ];
        };
    in
    {
      homeConfigurations."yohanes@desktop" = mkHome ./home/hosts/desktop.nix;
      homeConfigurations."yohanes@laptop" = mkHome ./home/hosts/laptop.nix;
      # canonical short name for this machine (dell-xps13) -> same as laptop
      homeConfigurations."yohanes@dell-xps13" = mkHome ./home/hosts/laptop.nix;
      # alias: full hostname dell-xps13-cachyos -> same config
      homeConfigurations."yohanes@dell-xps13-cachyos" = mkHome ./home/hosts/laptop.nix;

      devShells.${system} = {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.go
          ];
        };
        node24 = pkgs.mkShell { packages = [ pkgs.nodejs_24 ]; };
      };

      formatter.${system} = pkgs.nixfmt;
    };
}
