import { write, unshiftYield } from './util.js'
import { Compiler, Syntax } from './compile.js'

let g = unshiftYield(function*(){while(true)write(yield)}(), 10)
g.next()
g.next(1)
g.next(2)
g.next(3)
g.next(4)
g.next(5)

let src = `fun main(): singleton = native[|console.log(10)|]
fun id<A>(x: A): A = x
fun let<A B>(x: A, f: [A]B): B = (f x)`
console.log(`Src: ${src}\n`)
let c = new Compiler(src)
//write([...new Syntax(c).syntax()])
console.log(`Obj: ${await c.compile()}`)