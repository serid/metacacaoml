import { write } from './util.ts'

import { Compiler, readPackageSourceFromFs, type PackageSource } from './compile.ts'

function test(src: PackageSource): void {
	let t = performance.now()
	let obj = new Compiler(src, true).compile()

	// write(`Obj: ${obj}`)
	// write(`Src: ${src}\n`)
	write(`Exec:`)
	eval?.(obj)
	console.log(performance.now()-t)
}

async function main(): Promise<void> {
	let src = await readPackageSourceFromFs("./src/test/")
	test(src)
}

await main()