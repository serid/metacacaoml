// MetaCacaoML stdlib
export default `
class Unit
| (C)
end
fun (anyways -:any): (Unit) = (Unit/C)

class Array 'A end
fun (newArray): (Array A) = native[|[]|]
fun (push self:(Array A) x:A): (Unit) = (anyways
  native[|self.push(x)|])

# [A]B is a type of functions from A to B.
# Function calls are parenthesised.
fun (let 'A 'B x:A f:[A]B): B = (f x)
fun (write 'A x:A): (Unit) = (anyways
  native[|console.log(x)|])
`