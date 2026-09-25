import { Compiler, packageSourceFromPaths, type PackageSource } from './compile.ts'
import { write } from './util.ts'

function test(src: PackageSource) {
	let t = performance.now()
	let obj = new Compiler(src, true).compile()

	// write(`Obj: ${obj}`)
	// write(`Src: ${src}\n`)
	write(`Exec:`)
	eval?.(obj)
	console.log(performance.now()-t)
}

async function main() {
	let src = await packageSourceFromPaths([
		"./src/test/std.meml.rs",
		"./src/test/test.meml.rs",
	])
	test(src)
}

await main()