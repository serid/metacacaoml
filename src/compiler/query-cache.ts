import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import objectHash from './vendor/object-hash/object-hash.js'

import { mapGet, mapInsertIfNotPresentP, mapSet, todo, write, type ObjectMap, type ObjectSet } from './util.ts'

export type BinaryString = string
export type Digest = BinaryString
export function bufferToBinaryString(buf: Buffer): BinaryString {
	// encoding "binary" is actually "latin1". it matches every byte to its
	// unicodepoint, so at least 2 bytes. believe it or not

	// js admits any byte sequence as a utf-16 string, even if it has unpaired
	// surrogate code units
	return buf.toString("utf-16le")
}
export function binaryStringToBase64(bs: BinaryString): string {
	return Buffer.from(bs, "utf-16le").toString("base64")
}

// A digest is a hash used as a compressed representation of data, suitable for
// equality testing.
// The equality test achieved by comparing digests is probalistic -- if two data instances are equal, they will certainly have equal digests. However when digests compare equal, original data might turn out to be different with a vanishingly small probability.
export let digestAlgorithm = "md5"
export let digestTiming = 0
export function digestSlow(o: any): BinaryString {
	let time = performance.now()

	// todo: restructure object-hash to store options, not construct and apply every time
	let options = { encoding: "buffer" }
	// let options = { encoding: "buffer", respectFunctionProperties: false, respectType: false }
	// let repr = JSON.stringify(o)
	let repr = objectHash(o, { ...options, algorithm: "passthrough" })
	let buf = objectHash(repr, { ...options, algorithm: digestAlgorithm })

	digestTiming += performance.now() - time
	// let buf = objectHash(o, { algorithm: digestAlgorithm, encoding: "buffer" })
	// write(o)
	// write(repr)
	// write()
	// write(JSON.stringify(o))
	// write()
	return bufferToBinaryString(buf)
	// also consider xxHash since I don't need cryptographic resilience, merely
	// very very good uniformity
}

export function digest(o: any): BinaryString {
	let time = performance.now()

	let repr = JSON.stringify(o)
	let buf = createHash(digestAlgorithm).update(repr).digest()

	digestTiming += performance.now() - time

	// write(repr)
	// write()

	return bufferToBinaryString(buf)
}

// My Bun output for `require('crypto').getHashes().join(", ")`:
// md4, md5, ripemd160, sha1, sha224, sha256, sha384, sha512, sha512-224,
// sha512-256, sha3-224, sha3-256, sha3-384, sha3-512

// Essentially a memoization cache for pure functions. Deviates from usual
// memoization in that instead of storing a complete copy of a previous
// argument list, it stores a long digest and uses it as a proxy when comparing
// cache keys against argument lists in new invocations.
// Different argument lists may have the same digest, meaning the comparison is
// probabilistic, but above 128 bits the chance is vanishingly small.
export class QueryCache {
	private cache: ObjectMap<ObjectMap<any>> = Object.create(null)

	// Content-addressed storage. First key is some label, then Digest.
	// Use this to get a pure reference to some bulky data you don't want to hash
	// every time it's used as a query argument.
	// CAS and `cache` are ocasionally garbage-collected. GC treats as live any
	// digest in `gcRoots`, but also scans found live objects in CAS and `cache`
	// for Digest strings, they are also counted live and are scanned further
	// transitively.
	private cas: ObjectMap<ObjectMap<any>> = Object.create(null)
	private gcRoots: ObjectSet = Object.create(null) // key is Digest

	constructor(
		queryNames: string[],
		casNames: string[],
		// maps file digest to its path and text, a true content-addressed storage
		private files: ObjectMap<[string, string]>) {
		for (let query of queryNames) this.cache[query] = Object.create(null)
		for (let casName of casNames) this.cas[casName] = Object.create(null)
	}

	getOrCompute<A>(query: string, args: any[],
		f: (qc: QueryCache, ..._: any[]) => A): A {
		return this.getOrComputeKnownDigest(query, args, digest(args), f)
	}

	// Use this if your query argument is already a digest.
	// Care must be taken to ensure `d` really captures all dependencies
	// of `args`.
	// E. g. collapsing ['HASHHERE'] to 'HASHHERE' is acceptable as long as all
	// invocations of this method for a given query name use the same convention.
	// This collapse is erroneous if I ever merge caches for different query names
	// into one hashmap.
	getOrComputeKnownDigest<A>(query: string, args: any[], d: Digest,
		f: (qc: QueryCache, ..._: any[]) => A): A {
		// write(`> ${query}(${join(args)})`)
		let row = mapGet(this.cache, query)
		let key = d
		let value = row[key]
		if (value !== undefined) {
			write(`cache hit: ${key}`)
			return value
		}

		return row[key] = f(this, ...args)
	}

	// changes every program execution, do not use in queries
	getFiles(): Digest[] {
		return Object.keys(this.files)
	}

	// pure function (except on error), use in queries
	getFile(fileDigest: Digest): [string, string] {
		return mapGet(this.files, fileDigest)
	}

	casAdd(type: string, o: any): Digest {
		let d = digest(o)

		// If an entry is already present at this key, keep its old value since
		// it is equal to `o` (very very probably).
		mapInsertIfNotPresentP(mapGet(this.cas, type), d, () => {
			// Add gc root
			mapSet(this.gcRoots, d, null)
			return o
		})
		return d
	}

	casGet(type: string, d: Digest): any {
		return mapGet(mapGet(this.cas, type), d)
	}

	private gc(): void {
		todo()
	}
}