# MetaCaCaoML stdlib
fun id('A x:A): A = x

class Unit
| C()
end
fun anyways(-:@any): Unit = Unit/C()
fun and('A -:@any other:A): A = other

class Bool
| False()
| True()
end
fun bool-from-native(b:@any): Bool =
  native[|b?yield*BoolᐅTrue():yield*BoolᐅFalse()|]

class Int end
fun .increment(x:Int): Int = native[|x+1|]
fun .lt(x:Int y:Int): Bool = bool-from-native(native[|x<y|])
fun .eq(x:Int y:Int): Bool = bool-from-native(native[|x===y|])
fun .add(x:Int y:Int): Int = native[|x+y|]
fun .sub(x:Int y:Int): Int = native[|x-y|]
fun .mul(x:Int y:Int): Int = native[|x*y|]
fun .div(x:Int y:Int): Int = native[|x/y|]
  
class String end

class Box 'A
| New(A)
end
fun .get('A self:Box(A)): A =
  native[|self._0|]
fun .set('A self:Box(A) x:A): Unit =
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
fun .length('A self:Array(A)): Int =
  native[|self.length|]
fun .get('A self:Array(A) i:Int): A =
  native[|self[i]|]
fun .push('A self:Array(A) x:A): Unit =
  anyways(native[|self.push(x)|])

# [A]B is a type of functions from A to B.
# Function calls are parenthesised.
fun let('A 'B x:A f:[A]B): B = f(x)
fun write('A x:A): Unit = anyways(
  native[|console.log(x)|])
  
class Iter 'A
| New([]Option(A))
end
fun .unpack('A i:Iter(A)): []Option(A) =
  Iter/elim(i id)
fun .for-each('A i:Iter(A) f:[A]Unit): Unit = Option/elim(i.unpack()())
  { . Unit/C() }
  { x. and(f(x) i.for-each(f)) }
fun .to-array('A i:Iter(A)): Array(A) =
  let(@[]) λ xs.
  let(i.for-each() λ x.
    xs.push(x)
  ) λ -.
  xs
fun .to-iter('A xs:Array(A)): Iter(A) =
  let(Box/New(0)) λ i.
  Iter/New() λ .
  let(i.get()) λ iv.
  Bool/elim(iv.lt(xs.length()))
  { . Option/None() }
  { . let(xs.get(iv)) λ elem.
    and(i.set(iv.increment()) Option/Some(elem)) }
fun .map('A 'B i:Iter(A) f:[A]B): Iter(B) =
  Iter/New() λ .
  Option/elim(i.unpack()())
  { . Option/None() }
  { x. Option/Some(f(x)) }