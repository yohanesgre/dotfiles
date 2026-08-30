# omp (oh-my-pi)

Managed via Nix flake `github:can1357/oh-my-pi` — reproducible, pinned in `flake.lock`.

- Input: `inputs.omp` in `flake.nix` (`inputs.nixpkgs.follows = "nixpkgs"` to avoid duplication)
- Module: `omp.homeManagerModules.default` imported in `flake.nix` `homeConfigurations.*.modules`
- Config: `home/modules/omp/default.nix` sets `programs.omp.enable = true; settings.startup.quiet = true;`
- Generated config at `~/.omp/agent/config.yml` via `programs.omp.settings` (home-manager)
- Overrides: add keys under `programs.omp.settings` in `home/modules/omp/default.nix`

No `curl https://omp.sh/install | sh` — Nix flake preferred per hybrid policy (reproducible > curl).

Verify:

```bash
nix eval .#homeConfigurations."yohanes@desktop".config.programs.omp --apply 'x: x.enable'  # → true
nix eval .#homeConfigurations."yohanes@desktop".config.home.packages --apply 'pkgs: map (p: p.pname or p.name or "") pkgs' | grep -i omp
```
