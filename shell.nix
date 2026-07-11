let
	sources = import ./npins;
	pkgs = import sources.nixpkgs {};
in
	pkgs.mkShell {
		packages = [
			pkgs.nodejs
			pkgs.bun
			pkgs.deno
			pkgs.typescript-go
		];
	}