import { write, unshiftYield } from './util.js'
import { Compiler, Syntax } from './compile.js'

let src = `fun id<A>(x: A): A = x
fun let<A B>(x: A, f: [A]B): B = (f x)
fun write<A>(x: A): any = native[|console.log(x)|]
fun main(): singleton =
  (let "10") λx =>
  (write x) 
`
console.log(`Src: ${src}\n`)
let c = new Compiler(src)
//write([...new Syntax(c).syntax()])
console.log(`Obj: ${await c.compile()}`)