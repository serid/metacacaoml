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
	assertL(deepEqual(x, y), () =>
		`found ${prettyPrint(x)}, expected ${prettyPrint(y)}`)
	return x
}

export function typeof2(o: any) {
	if (Array.isArray(o)) return "array"
	return typeof o
}

export function* range(a: number, b?: number, step = 1) {
	if (b===undefined) {
		b = a
		a = 0
	}
	for (let i = a; i < b; i += step)
		yield i
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
		for (let x of view(o, 1, o.length))
			r += ", " + prettyPrint(x)
		return r + "]"
	}
	if (typeof o === "object") {
		let entries = Object.entries(o)
		if (entries.length === 0) return "{}"
		let r = `{ ${entries[0][0]}: ${prettyPrint(entries[0][1])}`
		for (let [key, value] of view(entries, 1))
			r += `, ${key}: ${prettyPrint(value)}`
		return r + " }"
	}
	return o.toString()
}

export function write(...os: any[]) {
	console.log(os.map(toString).join(" "))
}

export function dbg(o: any) {
	write(o)
	return o
}

export function nonExhaustiveMatch(o: any) {
	error("unhandled branch: " + prettyPrint(o))
}


export function deepEqual(x: any, y: any) {
	if (x === y) return true

	assertL(typeof2(x) === typeof2(y), () =>
		`found ${prettyPrint(x)}, expected ${prettyPrint(y)}`)

	switch (true) {
	case Array.isArray(x):
		if (x.length !== y.length) return false
		for (let i of indices(x))
			if (!deepEqual(x[i], y[i])) return false
		return true
	default:
		return false
	}
}

export type ArrayMap<A> = Array<A>

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

export function mapRemove<A>(o: ObjectMap<A>, key: string | number) {
	assert(o[key] !== undefined, "key not present: "+key)
	delete o[key]
}

// create a projection of a map that has all same entries with
// values filtered and transformed by f
export function mapFilterMapProjection<A, B>(o: ObjectMap<A>, f: (name: string, code: A) => B | null): ObjectMap<B> {
	return any(new Proxy(o, {
		get(target, key: string, _receiver) {
			let value = Reflect.get(target, key)
			if (value === undefined) return undefined
			let out = f(key, value)
			assert(out !== null, key + " is nullish")
			return out
		},

		ownKeys(target) {
			return [...filterMap(Object.entries(target), ([k,v])=>f(k,v)===null?null:k)]
		}
	}))
}

export function mapMap<A, B>(o: ObjectMap<A>, f: (_: A) => B) {
	let out: ObjectMap<B> = Object.create(null)
	for (let k in o) {
		out[k] = f(o[k])
	}
	return out
}

export interface ObjectSet{ [k: string]: any | undefined }

export function setContains(o: ObjectSet, key: string) {
	return o[key] !== undefined
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
	let iteratorResult = g.next(arg)
	assert(iteratorResult.done, "expected last")
	return <B>iteratorResult.value
}

export function getOne<A>(g: Generator<A, void, void>) {
	let { value } = g.next()
	assert(value !== undefined, "got undefined")
	return <A>value
}
export function getOneOrDef<A>(g: Generator<A, void, void>, d: A) {
	let { value } = g.next()
	return value === undefined ? d : <A>value
}



export function unSingleton<A>(xs: A[]): A {
	assertEq(xs.length, 1)
	return xs[0]
}

export function first<A>(xs: A[]) {
	assert(xs.length > 0, "array is empty")
	return xs[0]
}

export function last<A>(xs: A[]) {
	assert(xs.length > 0, "array is empty")
	return xs[xs.length-1]
}

export function indices<A>(xs: A[]) {
	return range(xs.length)
}

export function* view<A>(
	xs: A[], from: number, to = xs.length, step = 1): Iterable<A> {
	for (let i of range(from, to, step)) yield xs[i]
}

export function* zip<A, B>(xs: A[], ys: B[]): Iterable<[A, B]> {
	for (let i of range(assertEq(xs.length, ys.length))) yield [xs[i], ys[i]]
}

export function mkArray<A>(length: number, x: A): A[] {
	return Array(length).fill(x)
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
	for (let [i, x] of xs.entries())
		if (f(x)) {
			ri = i
			break
		}
	if (ri === -1)
		return ri
	for (let x of view(xs, ri + 1))
		if (f(x)) error("not unique")
	return ri
}

export function* map<A, B>(i: Iterable<A>, f: (_: A) => B) {
	for (let x of i) yield f(x)
}

export function* filter<A>(i: Iterable<A>, f: (_: A) => boolean) {
	for (let x of i) if (f(x)) yield x
}

export function* filterMap<A, B>(i: Iterable<A>, f: (_: A) => B | null) {
	for (let x of i) {
		let y = f(x)
		if (y !== null) yield y
	}
}

export function foldl<A, B>(i: Iterable<B>, s: A, c: (_: A, _0: B) => A) {
	for (let x of i) s = c(s, x)
	return s
}

export function join(i: Iterable<string>, sep=", "): string {
	let a = Array.isArray(i) ? i : [...i]
	return a.join(sep)
}

/*
// join implementation biased for stream processing.
// avoids allocating an intermediate array
export function join(i: Iterable<string>, sep=", "): string {
	let g = it(i)
	return foldl(g, getOneOrDef(g, ""), (s, x) => s + sep + x)
}
*/

export function forEach<A>(i: Iterable<A>, f: (_: A) => void) {
	for (let x of i) f(x)
}

export function* bind(i: any, k: any) {
	for (let x of i)
		for (let y of k(x)) yield y
}

export class LateInit<T> {
	private value: T | null

	constructor(value?: T) {
		if (value === undefined)
			this.value = null
		else
			this.value = value
	}

	isSet(): boolean {
		return this.value !== null
	}

	get(): T {
		if (this.value === null)
			error("value not set yet")
		return this.value
	}

	set(value: T) {
		if (this.value !== null)
			error("value already set")
		this.value = value
	}

	setIfUnsetThen(value: ()=>T) {
		if (this.value===null)
			this.value = value()
	}
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