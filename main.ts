import { Compiler } from './compile.ts'
import { write } from './util.ts'

async function test() {
	let t = performance.now()
	let src = await globalThis.Deno.readTextFile("./test.meml.rs")
	let obj = new Compiler(src, true).compile()

	// write(`Obj: ${obj}`)
	// write(`Src: ${src}\n`)
	write(`Exec:`)
	eval?.(obj)
	console.log(performance.now()-t)
}

async function main() {
	if (globalThis.Deno.args.length === 0) {
		await test()
		return
	}

	let src = await globalThis.Deno.readTextFile(globalThis.Deno.args[0])
	eval?.(new Compiler(src, false).compile())
}

await main()