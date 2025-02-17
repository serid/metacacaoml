export function any(x: any): any {
  return x
}

export function error(e?: string): never {
  throw new Error(e)
}

export function assert(b: boolean, e?: string) {
  if (!b) error(e) 
}

export function assertL(b: boolean, le: () => string) {
  if (!b) error(le())
}

export function assertEq(x: any, y: any) {
  assertL(x === y, () => `found ${prettyPrint(x)}, expected ${prettyPrint(y)}`)
  return x
}

export function prettyPrint(o: any) {
  if (typeof o === "string")
    return '"' + o + '"'
  return toString(o)
}

export function toString(o: any) {
  if (o === null)
    return "null"
  if (o === undefined)
    return "undefined"
  if (Array.isArray(o)) {
    if (o.length === 0) return "[]"
    let r = "[" + prettyPrint(o[0])
    for (let i = 1; i < o.length; i++)
      r += ", " + prettyPrint(o[i])
    return r + "]"
  }
  if (typeof o === "object") {
    let keys = [...Object.keys(o)]
    if (keys.length === 0) return "{}"
    let r = `{ ${keys[0]}: ${prettyPrint(o[keys[0]])}`
    for (let i = 1; i < keys.length; i++)
      r += `, ${keys[i]}: ${prettyPrint(o[keys[i]])}`
    return r + " }"
  }
  return o.toString()
}

export function write(...os: any[]) {
  console.log(join(map(os, toString), " "))
}

export function dbg(o: any) {
  write(o)
  return o
}

export function nonExhaustiveMatch(o: any) {
  error("unhandled branch: " + prettyPrint(o))
}



export interface ObjectMap<A> { [k: string]: A }

export function mapInsert<A>(o: ObjectMap<A>, key: string | number, value: A) {
  assert(["string","number"].includes(typeof key))
  assert(o[key] === undefined, "key already present: "+key)
  o[key] = value
}

export function mapGet<A>(o: ObjectMap<A>, key: string | number) {
  let value = o[key]
  assert(value !== undefined, "key not present: "+key)
  return value
}

export function mapMap<A, B>(o: ObjectMap<A>, f: (_: A) => B) {
  let out: ObjectMap<B> = Object.create(null)
  for (let k in o) {
    out[k] = f(o[k])
  }
  return out
}


// Synchronous queue that may request a new element through a generator
export class Pakulikha<A> {
  q: A | null

  constructor() {
    this.q = null
  }
  send(x: A) {
    assert(this.q === null)
    this.q = x
  }
  *recv() {
    if (this.q === null) yield
    let ret = <A>this.q
    this.q = null
    return ret
  }
}

export function step<A>(g: Generator<A, void, any>, arg?: any) {
  let val = g.next(arg).value
  assertL(val === undefined, () => "expected nothing, got " + prettyPrint(val))
}

export function nextLast<A, B>(g: Generator<A, B, any>, arg?: any) {
  let { value, done } = g.next(arg)
  assert(done!, "expected last")
  return value
}

export function getOne<A>(g: Generator<A, void, void>) {
  let { value } = g.next()
  assert(value !== undefined, "got undefined")
  return value
}
export function getOneOrDef<A>(g: Generator<A, void, void>, d: A) {
  let { value } = g.next()
  return value === undefined ? d : value
}



export function last<A>(xs: A[]) {
  return xs[xs.length-1]
}

// array to iterator
export function* makeIt<A>(xs: Iterable<A>) {
  for (let x of xs) yield x
}

// ensures argument is an iterator
export function it(xs: any): Generator<any, void, any> {
  return "next" in xs ? xs : makeIt(xs)
}

export function findUniqueIndex<A>(xs: A[], f: (_: A) => boolean) {
  let ri = -1
  for (var i = 0; i < xs.length; i++)
    if (f(xs[i])) {
      ri = i
      break
    }
  if (ri === -1)
    return ri
  for (var i = ri + 1; i < xs.length; i++)
    if (f(xs[i])) error("not unique")
  return ri
}

export function* map<A, B>(i: Iterable<A>, f: (_: A) => B) {
  for (let x of i) yield f(x)
}

export function* filter<A>(i: Iterable<A>, f: (_: A) => boolean) {
  for (let x of i) if (f(x)) yield x
}

export function foldl<A, B>(i: Iterable<B>, s: A, c: (_: A, _0: B) => A) {
  for (let x of i) s = c(s, x)
  return s
}

export function join(i: Iterable<string>, sep=", "): string {
  let g = it(i)
  return foldl(g, getOneOrDef(g, ""), (s, x) => s + sep + x)
}

export function forEach<A>(i: Iterable<A>, f: (_: A) => void) {
  for (let x of i) f(x)
}

export function* bind(i: any, k: any) {
  for (let x of i)
    for (let y of k(x)) yield y
}

class Fuel {
  x: number

  constructor(x: number) {
    this.x = x
  }
  
  step() {
    if (--this.x === 0) error("all out of fuel")
  }
}

export let fuel = new Fuel(1000)

// great stuff right here
export const GeneratorFunction: any = function* () {}.constructor