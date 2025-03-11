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
  native[|b?yield*_fixtures_.BoolᐅTrue():yield*_fixtures_.BoolᐅFalse()|]

class Int end
fun .increment(x:Int): Int = native[|x+1|]
fun .lt(x:Int y:Int): Bool = bool-from-native(native[|x<y|])
fun .eq(x:Int y:Int): Bool = bool-from-native(native[|x===y|])
fun .add(x:Int y:Int): Int = native[|x+y|]
fun .sub(x:Int y:Int): Int = native[|x-y|]
fun .mul(x:Int y:Int): Int = native[|x*y|]
fun .div(x:Int y:Int): Int = native[|x/y|]
  
class String end

class Pair 'A 'B
| New(A B)
end

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

class Array 'A end
fun .length('A xs:Array(A)): Int =
  native[|xs.length|]
fun .get('A xs:Array(A) i:Int): A =
  native[|xs[i]|]
fun .push('A xs:Array(A) x:A): Unit =
  anyways(native[|xs.push(x)|])
fun .shallow-copy('A xs:Array(A)): Array(A) =
  native[|[...xs]|]
fun .sort('A xs:Array(A) cmp:[A A]Int): Array(A) =
  native[|[...xs].sort(cmp)|]

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