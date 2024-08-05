export function error(e) {
  throw new Error(e)
}

export function assert(b, e) {
  if (!b) error(e) 
}

export function assertL(b, le) {
  if (!b) error(le())
}

export function assertEq(x, y) {
  assertL(x === y, () => `found ${toString(x)}, expected ${toString(y)}`)
  return x
}

export function toString(o) {
  if (o === null)
    return "null"
  if (o === undefined)
    return "undefined"
  if (Array.isArray(o)) {
    if (o.length === 0) return "[]"
    let r = "[" + toString(o[0])
    for (let i = 1; i < o.length; i++)
      r += ", " + toString(o[i])
    return r + "]"
  }
  if (typeof o === "string")
    return '"' + o + '"'
  if (typeof o === "object") {
    let keys = [...Object.keys(o)]
    if (keys.length === 0) return "{}"
    let r = `{ ${keys[0]}: ${toString(o[keys[0]])}`
    for (let i = 1; i < keys.length; i++)
      r += `, ${keys[i]}: ${toString(o[keys[i]])}`
    return r + " }"
  }
  return o.toString()
}

export function write(...os) {
  console.log(join(map(os, toString), " "))
}

export function dbg(o) {
  write(o)
  return o
}

export function nonExhaustiveMatch(o, at) {
  error("unhandled branch: " + toString(o))
}



export function step(g, arg) {
  let val = g.next(arg).value
  assertL(val === undefined, () => "expected nothing, got " + toString(val))
}

export function nextLast(g, arg) {
  let { value, done } = g.next(arg)
  assert(done, "expected last")
  return value
}

export function* unshiftYield2(g, arg) {
  let { value, done } = g.next(arg)
  if (done) return value
  return yield* g
}

export function* unshiftYield(g, arg) {
  step(g)
  let { value, done } = g.next(arg)
  if (done) return value
  
  return yield* swallow(g)
}

// same as yield* minus the initial .next(undefined)
export function* swallow(g) {
  // todo: yield what
  while (true) {
    let { value, done } = g.next(yield)
    if (done) return value
  }
}

export function getOne(i) {
  const { value, done } = i.next()
  assert(value !== undefined, "got undefined")
  return value
}
export function getOneOrDef(i, d) {
  const { value, done } = i.next()
  return value === undefined ? d : value
}



export function* it(array) {
  for (let x of array) yield x
}

export function findUniqueIndex(xs, f) {
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

export function* map(i, f) {
  for (let x of i) yield f(x)
}

export function foldl(i, s, c) {
  for (let x of i) {
    s = c(s, x)
  }
  return s
}

export function join(i, sep=", ") {
  return foldl(i, getOneOrDef(i, ""), (s, x) => s + sep + x)
}

export function forEach(i, f) {
  for (let x of i) f(x)
}

export function* bind(i, k) {
  for (let x of i)
    for (let y of k(x)) yield y
}

class Fuel {
  constructor(x) {
    this.x = x
  }
  
  step() {
    if (--this.x === 0) error("all out of fuel")
  }
}

export let fuel = new Fuel(1000)