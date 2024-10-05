import { write } from './util.js'
import { Compiler } from './compile.js'

let t = performance.now()
function tyckTest() {
new Compiler(`
fun foo(): String = ""
@Fails(error: "A" is not a subtype of "B" at "")
fun f('A 'B x:A): B = x
`)//.compile()
}

tyckTest()

let src = `
# What follows is a GSLR(1) parser generation library for Meml


fun main(): Unit() =
  let(native[|[1, 2, 3]|]) λarray.
  let(write(array)) λ-.
  let(arrayToIter(array)) λiterator.
  let(iterMap(iterator intIncr)) λincremented.
  write(iterToArray(incremented))
`
let c = new Compiler(src)
//write([...new Syntax(c).syntax()])
let obj = c.compile()
//document.getElementById("out").innerText = obj
console.log(`Obj: ${obj}`)
console.log(`Src: ${src}\n`)
console.log(`Exec:`)
eval?.(obj)
console.log(performance.now()-t)