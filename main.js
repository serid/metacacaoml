import { write, unshiftYield } from './util.js'
import { Compiler } from './compile.js'

async function tyckTest() {
await new Compiler(`

fun (foo): String = ""
@Fails(error: "A" is not a subtype of "B" at "")
fun (f 'A 'B x:A): B = x

# [A]B is a type of functions from A to B.
# Function calls are parenthesised.
fun (let 'A 'B x:A f:[A]B): B = (f x)
fun (write 'A x:A): any = native[|console.log(x)|]
fun (main): singleton =
  # Lambdas are passed after function call
  (let "10") λx.
  (write x)
`).compile()
}

await tyckTest()

let src = `
class Option 'A
| (None)
| (Some A)
end

# Adds constructors and a matching function to global scope
# Matching function Option/elim analyses the object in first parameter and chooses one of lambdas passed to it, while giving it the object's fields

#let -check1: [(Option Int) []String [Int]String]String
let -check1: [Option []String [Int]String]String
= Option/elim

fun (write 'A x:A): any = native[|console.log(x)|]
fun (main): singleton =
  # When function accepts multiple lambdas, they are written in brace notation
  (Option/elim (Option/Some "1"))
  { . (write "none") }
  { x. (write x) }
`
let c = new Compiler(src)
//write([...new Syntax(c).syntax()])
let obj = await c.compile()
document.getElementById("out").innerText = obj
//onsole.log(`Obj: ${obj}`)
console.log(`Src: ${src}\n`)
console.log(`Exec:`)
eval(obj)
