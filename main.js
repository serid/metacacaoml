import { write, unshiftYield } from './util.js'
import { Compiler } from './compile.js'

async function tyckTest() {
await new Compiler(`

fun foo(): String = ""
@Fails(error: "A" is not a subtype of "B" at "")
fun f<A B>(x: A): B = x

fun let<A B>(x: A, f: [A]B): B = (f x)

fun write<A>(x: A): any = native[|console.log(x)|]
fun main(): singleton =
  (let "10") λx.
  (write x)
`).compile()
}

await tyckTest()

let src = `
class Option<A>
| None()
| Some(A)
end

fun let<A B>(x: A, f: [A]B): B = (f x)
fun write<A>(x: A): any = native[|console.log(x)|]
fun main(): singleton =
  (Option::elim (Option::None))
  { . (write "none") }
  { x. (write x) }
`
console.log(`Src: ${src}\n`)
let c = new Compiler(src)
//write([...new Syntax(c).syntax()])
console.log(`Obj: ${await c.compile()}`)