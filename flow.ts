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

	// Resolver allows to fillin the result early to allow recursive queries
	// in partially finished queries
	// E. g.: typecheking an item is considered complete once its signature
	// is in globals, but it might still be checking its body, at which point
	// recursive calls to this item should see the signature, so it should be
	// filled in before normal return.
	memoizeWithResolver<A>(path: string, args: string[],
		duct: (resolve: (_: A) => void, ..._: string[]) => A): A {
		// write(`> ${path}(${join(args)})`)
		let column = mapGet(this.cache, path)
		let key = argsToString(args)
		let value = column[key]
		if (value !== undefined) return value

		value = duct(x => column[key] = x, ...args)
		column[key] = value
		return value
	}

	memoize<A>(path: string, args: string[], duct: (..._: string[]) => A): A {
		return this.memoizeWithResolver(path, args, (_, ...args) => duct(...args))
	}

	resetCache() {
		for (let path of this.paths) this.cache[path] = Object.create(null)
	}
}