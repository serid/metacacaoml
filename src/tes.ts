import { readFile } from 'node:fs/promises'

import { Compiler } from './compile.ts'
import { write } from './util.ts'

function test(src: string) {
	let t = performance.now()
	let obj = new Compiler(src, true).compile()

	// write(`Obj: ${obj}`)
	// write(`Src: ${src}\n`)
	write(`Exec:`)
	eval?.(obj)
	console.log(performance.now()-t)
}

async function main() {
	test(await readFile("./src/test.meml.rs", { encoding:"utf-8" }))
	/* test(`
fun .test-to-Array('A i:Iter(A)): Array(A) =
	# todo: buff up type inference to allow \`as\` here
	@[] as fun λ xs.
	i.for-each { x.
		xs.push(x)
	};
	xs

fun main(): Iota =
Iota/Iota()`) */
}

await main()