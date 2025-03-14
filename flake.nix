{
	nixConfig.bash-prompt-suffix = "dev$ ";

	inputs = {
		nixpkgs.url = "github:nixos/nixpkgs/nixos-24.11";
	};

	outputs = { self, nixpkgs }:
		let pkgs = nixpkgs.legacyPackages.x86_64-linux; in {
			devShell.x86_64-linux = pkgs.mkShell {
				packages = [ pkgs.deno ];
		};
	};
}