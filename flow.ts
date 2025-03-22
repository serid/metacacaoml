// Pull-style query system for compilers

import { mapGet, ObjectMap } from "./util.ts"

function argsToString(args: string[]) {
	return args.join(":")
}

export class Network {
	private cache: ObjectMap<ObjectMap<any>> = Object.create(null)

	constructor(private paths: string[]) {
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