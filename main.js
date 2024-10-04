import { write } from './util.js'
import { Compiler } from './compile.js'

function tyckTest() {
new Compiler(`

fun foo(): String = ""
@Fails(error: "A" is not a subtype of "B" at "")
fun f('A 'B x:A): B = x

fun main2(): Unit() =
  # When function accepts multiple lambdas, they are written in brace notation
  Option/elim(Option/Some("1"))
  { . (write("none")) }
  { x. write(x) }
`).compile()
}

tyckTest()

let src = `
# What follows is a GSLR(1) parser generation library for Meml


fun main(): Unit() =
  let("10 + 10") λ x.
  write(x)
`
let c = new Compiler(src)
//write([...new Syntax(c).syntax()])
let obj = c.compile()
document.getElementById("out").innerText = obj
console.log(`Obj: ${obj}`)
console.log(`Src: ${src}\n`)
console.log(`Exec:`)
eval(obj)
