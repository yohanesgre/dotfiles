{
  description = "yohanes dotfiles - home-manager standalone (CachyOS x86_64-linux)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      ...
    }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      mkHome =
        hostFile:
        home-manager.lib.homeManagerConfiguration {
          inherit pkgs;
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
