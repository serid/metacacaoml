// MetaCacaoML stdlib
export default `
fun id('A x:A): A = x

class Unit
| C()
end
fun anyways(-:any): Unit() = Unit/C()

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
fun push(self:Array(A) x:A): Unit() = anyways(
  native[|self.push(x)|])

# [A]B is a type of functions from A to B.
# Function calls are parenthesised.
fun let('A 'B x:A f:[A]B): B = f(x)
fun write('A x:A): Unit() = anyways(
  native[|console.log(x)|])
  
class Iter 'A
| C([]A)
end
fun runIter('A i:Iter(A)): []A =
  Iter/elim(i id)
  

`