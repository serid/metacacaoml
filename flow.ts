// Pull-style query system for compilers

import { mapGet, ObjectMap } from "./util.ts"

function argsToString(args: string[]) {
	return args.join(":")
}

export class ItemNetwork {
	paths: string[]
	cache: ObjectMap<ObjectMap<any>>

	constructor(paths: string[]) {
		this.paths = paths
		this.cache = Object.create(null)
		this.resetCache()
	}

	memoize<A>(path: string, args: string[], duct: (..._: string[]) => A): A {
		// write(`> ${path}(${join(args)})`)
		let column = mapGet(this.cache, path)
		let key = argsToString(args)
		let value = column[key]
		if (value !== undefined) return value

		value = duct(...args)
		column[key] = value
		return value
	}

	resetCache() {
		for (let path of this.paths) this.cache[path] = Object.create(null)
	}
}