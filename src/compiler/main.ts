import { Compiler, packageSourceFromPaths } from './compile.ts'

async function main() {
	process.argv.splice(0, 2) // drop executable path and script path
	// assert(process.argv.length === 1, "Expecting exactly 1 argument.")

	let src = await packageSourceFromPaths(process.argv)
	eval?.(new Compiler(src, false).compile())
}

await main()