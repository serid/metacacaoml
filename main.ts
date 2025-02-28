import { Compiler } from './compile.ts'

let t = performance.now()
function tyckTest() {
new Compiler(`
fun foo(): String = ""
@Fails(error: "A" is not a subtype of "B" at "# MetaCaCaoML stdlib")
fun f('A 'B x:A): B = x
`, false).compile()
}

tyckTest()

let src = `
# What follows is a GSLR(1) parser generation library for Meml

let x: id(Int) = 1

fun main(): Unit =
  let(@[1 2 3]) λarray.
  let(write(array)) λ-.
  let(Array/to-iter(array)) λiterator.
  let(iterator.map(Int/increment)) λincremented.
  write(incremented.to-array())
`
let c = new Compiler(src, true)
//write([...new Syntax(c).syntax()])
let obj = c.compile()
//document.getElementById("out").innerText = obj
console.log(`Obj: ${obj}`)
console.log(`Src: ${src}\n`)
console.log(`Exec:`)
eval?.(obj)
console.log(performance.now()-t)