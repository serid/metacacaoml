// MetaCacaoML stdlib
export default `
fun id('A x:A): A = x

class Unit
| C()
end
fun anyways(-:any): Unit() = Unit/C()
fun and('A -:any other:A): A = other

class Bool
| False()
| True()
end
fun boolFromNative(b:any): Bool() =
  native[|b?Bool$True():Bool$False()|]

class Int end
let zero: Int = native[|0|]
fun intIncr(x:Int): Int = native[|x+1|]
fun intLt(x:Int y:Int): Bool() =
  boolFromNative(native[|x<y|])

class Box 'A
| New(A)
end
fun boxGet('A self:Box(A)): A =
  native[|self._0|]
fun boxSet('A self:Box(A) x:A): Unit() =
  anyways(native[|self._0 = x|])

class Option 'A
| None()
| Some(A)
end

# Adds constructors and a matching function to global scope
# Matching function Option/elim analyses the object in first parameter and chooses one of lambdas passed to it, while giving it the object's fields

let -check1: [Option(Int) []String [Int]String] String
  = Option/elim

class Array 'A end
fun newArray(): Array(A) = native[|[]|]
fun arrayLength('A self:Array(A)): Int =
  native[|self.length|]
fun arrayGet('A self:Array(A) i:Int): A =
  native[|self[i]|]
fun arrayPush(self:Array(A) x:A): Unit() =
  anyways(native[|self.push(x)|])

# [A]B is a type of functions from A to B.
# Function calls are parenthesised.
fun let('A 'B x:A f:[A]B): B = f(x)
fun write('A x:A): Unit() = anyways(
  native[|console.log(x)|])
  
class Iter 'A
| New([]Option(A))
end
fun iterRun('A i:Iter(A)): []Option(A) =
  Iter/elim(i id)
fun iterForEach('A i:Iter(A) f:[A]Unit()): Unit() = Option/elim(iterRun(i)())
  { . Unit/C() }
  { x. and(f(x) iterForEach(i f)) }
fun iterToArray('A i:Iter(A)): Array(A) =
  let(newArray()) λ xs.
  let(iterForEach(i) λ x.
    arrayPush(xs x)
  ) λ -.
  xs
fun arrayToIter('A xs:Array(A)): Iter(A) =
  let(Box/New(zero)) λ i.
  Iter/New() λ .
  let(boxGet(i)) λ iv.
  Bool/elim(intLt(iv arrayLength(xs)))
  { . Option/None() }
  { . let(arrayGet(xs iv)) λ elem.
    and(boxSet(i intIncr(iv)) Option/Some(elem)) }
fun iterMap('A 'B i:Iter(A) f:[A]B): Iter(B) =
  Iter/New() λ .
  Option/elim(iterRun(i)())
  { . Option/None() }
  { x. Option/Some(f(x)) }
`