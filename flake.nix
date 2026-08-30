{
  description = "yohanes dotfiles - home-manager standalone (CachyOS x86_64-linux)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    omp = {
      url = "github:can1357/oh-my-pi";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      omp,
      ...
    }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      homeConfigurations."yohanes@desktop" = home-manager.lib.homeManagerConfiguration {
        inherit pkgs;
        modules = [
          omp.homeManagerModules.default
          ./home/common.nix
          ./home/hosts/desktop.nix
        ];
      };
      homeConfigurations."yohanes@laptop" = home-manager.lib.homeManagerConfiguration {
        inherit pkgs;
        modules = [
          omp.homeManagerModules.default
          ./home/common.nix
          ./home/hosts/laptop.nix
        ];
      };
    };
}
