import process from 'node:process'

import { Compiler, readPackageSourceFromFs } from './compile.ts'
import { assert } from './util.ts'

async function main() {
	process.argv.splice(0, 2) // drop executable path and script path
	assert(process.argv.length === 1, "Expecting exactly 1 argument.")

	let src = await readPackageSourceFromFs(process.argv[0])
	eval?.(new Compiler(src, false).compile())
}

await main()