import { Buffer } from 'node:buffer'

import objectHash from './vendor/object-hash/object-hash.js'

import { mapGet, write, type ObjectMap } from './util.ts'

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
export function digest(o: any): BinaryString {
	// todo: restructure object-hash to store options, not construct and apply every time
	let buf = objectHash(o, { algorithm: "SHA256", encoding: "buffer" })
	return bufferToBinaryString(buf)
	// also consider xxHash since I don't need cryptographic resilience, merely
	// very very good uniformity
}

// Essentially a memoization cache for pure functions. Deviates from usual
// memoization in that instead of storing a complete copy of a previous
// argument list, it stores a long digest and uses it as a proxy when comparing
// cache keys against argument lists in new invocations.
// Different argument lists may have the same digest, meaning the comparison is
// probabilistic, but above 128 bits the chance is vanishingly small.
export class QueryCache {
	private cache: ObjectMap<ObjectMap<any>> = Object.create(null)

	constructor(
		queryNames: string[],
		// maps file digest to its path and text, a true content-addressed storage
		private files: ObjectMap<[string, string]>) {
		for (let query of queryNames) this.cache[query] = Object.create(null)
	}

	getOrCompute<A>(query: string, args: any[],
		f: (qc: QueryCache, ..._: any[]) => A): A {
		// write(`> ${query}(${join(args)})`)
		let row = mapGet(this.cache, query)
		let key = digest(args)
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
}