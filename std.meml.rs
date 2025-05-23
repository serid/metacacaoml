# MetaCaCaoML stdlib
class Void end
class Iota
| Iota()
end
fun anyways(-:@any): Iota = Iota/Iota()
fun seq('A -:@any other:A): A = other

fun id('A x:A): A = x
fun fun('A f:A): A = f
fun compose('A 'B 'C g:[B]C f:[A]B): [A]C =
	fun λ x. g(f(x))
fun compose2('A 'B 'C 'D g:[C]D f:[A B]C): [A B]D =
	fun λ x y. g(f(x y))

fun let('A 'B x:A f:[A]B): B = f(x)
fun write('A x:A): Iota = anyways(
	native[|console.log(x)|])
fun error(m:String): @any =
	native[|(()=>{throw new Error(m)})()|]

class Bool
| False()
| True()
end
fun Bool/from-native(b:@any): Bool =
	native[|b?yield*_fixtures_.BoolᐅTrue():yield*_fixtures_.BoolᐅFalse()|]
fun .then('A b:Bool onTrue:[]A onFalse:[]A): A =
	Bool/elim(b onFalse onTrue)
fun .choose('A b:Bool onTrue:A onFalse:A): A =
	Bool/elim(b) { . onFalse } { . onTrue }

class Ordering
| Lt()
| Eq()
| Gt()
end
fun Ordering/from-lt-eq('A lt:[A A]Bool eq:[A A]Bool): [A A]Ordering =
	fun λ x y.
	eq(x y).then(Ordering/Eq)
	{ . lt(x y).then(Ordering/Lt Ordering/Gt) }
fun .to-Int(ord:Ordering): Int =
	Ordering/elim(ord) { . -1} { . 0} { . 1}

infix left at 100. "*" = ".mul"
infix left at 100. "/" = ".div"
infix left at 100. "%" = ".rem"

infix left at 75. "+" = ".add"
infix left at 75. "-" = ".sub"

infix at 60. "<=>" = ".cmp"

infix at 50. "==" = ".eq"
infix at 50. "!=" = ".neq"
infix at 50. "<" = ".lt"
infix at 50. "<=" = ".le"
infix at 50. ">" = ".gt"
infix at 50. ">=" = ".ge"

#infix left at 25. "&&" = ".and"
#infix left at 20. "||" = ".or"

infix right at .0 ";" = "seq"
infix right at .0 "as" = "let"

class Int end
let -1: Int = 0 - 1
fun .increment(x:Int): Int = x + 1
fun .lt(x:Int y:Int): Bool = Bool/from-native(native[|x<y|])
fun .eq(x:Int y:Int): Bool = Bool/from-native(native[|x===y|])
let Int/cmp: [Int Int]Ordering = Ordering/from-lt-eq(Int/lt Int/eq)
fun .add(x:Int y:Int): Int = native[|x+y|]
fun .sub(x:Int y:Int): Int = native[|x-y|]
fun .mul(x:Int y:Int): Int = native[|x*y|]
fun .div(x:Int y:Int): Int = native[|x/y|]
fun .rem(x:Int y:Int): Int = native[|x%y|]

class String end
fun .lt(x:String y:String): Bool = Bool/from-native(native[|x<y|])
fun .eq(x:String y:String): Bool = Bool/from-native(native[|x===y|])
let String/cmp: [String String]Ordering =
	Ordering/from-lt-eq(String/lt String/eq)

class Pair 'A 'B
| New(A B)
end
fun .fst('A 'B pair:Pair(A B)): A =
	Pair/elim(pair) { x y. x}
fun .snd('A 'B pair:Pair(A B)): B =
	Pair/elim(pair) { x y. y}

class Box 'A
| New(A)
end
fun .get('A self:Box(A)): A =
	native[|self._0|]
fun .set('A self:Box(A) x:A): Iota =
	anyways(native[|self._0 = x|])
fun .modify('A self:Box(A) f:[A]A): Iota =
	self.set(f(self.get()))

class Option 'A
| None()
| Some(A)
end
fun .unwrap('A self:Option(A)): A =
	Option/elim(self)
	{ . error("called `Option/unwrap` on a `None` value") }
	{ x. x }
fun .bind('A 'B self:Option(A) k:[A]Option(B)): Option(B) =
	Option/elim(self)
	{ . Option/None() }
	{ x. k(x) }
fun .map('A 'B self:Option(A) f:[A]B): Option(B) =
	self.bind(compose(Option/Some f))

class Array 'A end
fun .length('A xs:Array(A)): Int =
	native[|xs.length|]
fun .get('A xs:Array(A) i:Int): A =
	native[|xs[i]|]
fun .push('A xs:Array(A) x:A): Iota =
	anyways(native[|xs.push(x)|])
fun .shallow-copy('A xs:Array(A)): Array(A) =
	native[|[...xs]|]
fun .sorted('A xs:Array(A) cmp:[A A]Ordering): Array(A) =
	compose2(Ordering/to-Int cmp) as fun λ cmp.
	native[|[...xs].sort((x,y)=>cmp(x,y).next().value)|]
fun .slice('A xs:Array(A) i:Int j:Int): Array(A) =
	native[|xs.slice(i, j)|]
fun .reverse('A xs:Array(A)): Iota =
	anyways(native[|xs.reverse()|])

fun .last('A xs:Array(A)): Option(A) =
	(xs.length() == 0).then()
	{ . Option/None() }
	{ . Option/Some(xs.get(xs.length() - 1)) }
fun .init('A xs:Array(A)): Option(Array(A)) =
	(xs.length() == 0).then()
	{ . Option/None() }
	{ . Option/Some(xs.slice(0 xs.length() - 1)) }
fun .unsnoc('A xs:Array(A)): Option(Pair(Array(A) A)) =
	xs.init().map λ init.
	(init xs.last().unwrap())

class Iter 'A
| New([]Option(A))
end
fun .unpack('A i:Iter(A)): []Option(A) =
	Iter/elim(i id)
fun .for-each('A i:Iter(A) f:[A]Iota): Iota = Option/elim(i.unpack()())
	{ . Iota/Iota() }
	{ x. f(x); i.for-each(f) }
fun .to-Array('A i:Iter(A)): Array(A) =
	# todo: buff up type inference to allow `as` here
	let(@[]) λ xs.
	i.for-each { x.
		xs.push(x)
	};
	xs
fun .to-Iter('A xs:Array(A)): Iter(A) =
	let(Box/New(0)) λ i.
	Iter/New λ .
	let(i.get()) λ iv.
	Bool/elim(iv < xs.length())
	{ . Option/None() }
	{ . xs.get(iv) as fun λ elem.
		i.set(iv.increment()); Option/Some(elem) }
fun .map('A 'B i:Iter(A) f:[A]B): Iter(B) =
	Iter/New λ .
	Option/elim(i.unpack()())
	{ . Option/None() }
	{ x. Option/Some(f(x)) }

class Type end
fun .name(t:Type): String = native[|t.fullName|]

fun make-tuple-type(ts:Array(Type)): Type =
	Pair/elim(ts.unsnoc().unwrap()) λ init last.
	init.reverse() as fun λ -.
	let(Box/New(last)) λ acc.
	init.to-Iter().for-each { t.
		acc.modify λ x. Pair(t x)
	};
	acc.get()