import { Compiler } from './compile.ts'
import { write } from './util.ts'

async function main() {
  let t = performance.now()
  let src = await globalThis.Deno.readTextFile("./test.meml.rs")
  let obj = new Compiler(src, false).compile()

  // write(`Obj: ${obj}`)
  // write(`Src: ${src}\n`)
  write(`Exec:`)
  eval?.(obj)
  console.log(performance.now()-t)
}

await main()