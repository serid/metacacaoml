import { readFile } from 'node:fs/promises'

import { Compiler } from './compile.ts'
import { write } from './util.ts'

async function test() {
	let t = performance.now()
	let src = await readFile("./test.meml.rs", { encoding:"utf-8" })
	let obj = new Compiler(src, true).compile()

	// write(`Obj: ${obj}`)
	// write(`Src: ${src}\n`)
	write(`Exec:`)
	eval?.(obj)
	console.log(performance.now()-t)
}

async function main() {
	process.argv.splice(0, 2) // drop executable path and script path
	if (process.argv.length === 0) {
		await test()
		return
	}

	let src = await readFile(process.argv[0], { encoding:"utf-8" })
	eval?.(new Compiler(src, false).compile())
}

await main()