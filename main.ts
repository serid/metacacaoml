import { Compiler } from './compile.ts'

let t = performance.now()
function tyckTest() {
new Compiler(`
fun foo(): String = ""
@Fails(error: "A" is not a subtype of "B" at "# MetaCaCaoML stdlib")
fun f('A 'B x:A): B = x

let -check-id: id(Int) = 1

let -check-tuple1: Pair(Int Pair(String Bool)) = (1 "" Bool/True())
let -check-tuple2: Int = (((1)))

# Adds constructors and a matching function to global scope
# Matching function Option/elim analyses the object in first parameter and chooses one of lambdas passed to it, while giving it the object's fields
let -check1: [Option(Int) []String [Int]String] String
  = Option/elim
`, false).compile()
}

tyckTest()

let src = `
# What follows is a GSLR(1) parser generation library for Meml


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