fun foo(): String = ""
@Fails(error: `A' is not a subtype of `B')
fun f('A 'B x:A): B = x

let -check-id: id(Int) = 1

let -check-tuple1: Pair(Int Pair(String Bool)) = (1 "" Bool/True())
let -check-tuple2: Int = (((1)))

let -check-let1: Type = Int
let -check-let2: -check-let1 = 1

# Adds constructors and a matching function to global scope
# Matching function Option/elim analyses the object in first parameter and chooses one of lambdas passed to it, while giving it the object's fields
let -check1: [Option(Int) []String [Int]String] String
	= Option/elim

fun compareTypes(x:Type y:Type): Ordering =
	x.name().cmp(y.name())
let -tuple-of-stuffs: make-tuple-type(@[Int String Bool].sorted(compareTypes)) =
	(Bool/True() 1 "string here")

fun main(): Unit =
let(@[1 2 3]) λarray.
let(write(array)) λ-.
let(Array/to-Iter(array)) λiterator.
let(iterator.map(Int/increment)) λincremented.
write(incremented.to-Array())