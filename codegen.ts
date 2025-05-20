import { assertEq, nonExhaustiveMatch, join, setContains, mapInsert, ObjectMap } from './util.ts'

import { Syntax } from "./syntax.ts"
import { CompileError, ItemCtx } from './compile.ts'
import { RootTyck } from './huk.ts'

export function mangle(path: string) {
	// hazard: unicode!!
	// characters found using shapecatcher.com
	path = path.replaceAll("/", "ᐅ")
	path = path.replaceAll("-", "ᜭ")
	if (["let"].includes(path)) path = "Ξ"+path
	return path
}

export class ItemCodegen {
private k: number = 0 // points one past the current instruction
private nextVar: number = 0
private code: string[] = []

constructor(
	private itemCtx: ItemCtx,
	private root: RootCodegen | null, // toplevel codegen
	private rootTyck: RootTyck, // toplevel tyck
	private item: any) {}

private ins() {
	return this.item.arena[Math.max(this.k-1, 0)]
}

private nextIns() {
	return this.item.arena[this.k]
}

private stepIns() {
	return this.item.arena[this.k++]
}

private alloc() {
	return "_" + this.nextVar++
}

private unshiftCode() {
	let out = this.code.join("")
	this.code = []
	return out
}

private emitSsa(e: string) {
	let ix = this.alloc()
	this.code.push(`  const ${ix} = ${e}\n`)
	return ix
}

private emitYieldStar(what: string): string {
	let yieldReturnVar = this.alloc()
	this.code.push(`  let ${yieldReturnVar}; while (true) { let pair = ${what}` +
		`.next(); if (pair.done) { ${yieldReturnVar} = pair.value; break }` +
		` yield pair.value }\n`)
	return yieldReturnVar
}

private expr(): string {
	try {
	let insLocation = this.k
	let ins = this.stepIns()
	switch (ins.tag) {
	case Syntax.strlit:
		return `"${ins.data}"`
	case Syntax.native:
		return ins.code
	case Syntax.int:
		return `${ins.data}`
	case Syntax.use: {
		let name = ins.name
		return setContains(this.rootTyck.globals, name) ?
			"_fixtures_."+name : name
	}
	case Syntax.array: {
		let ixs: string[] = []
		while (this.nextIns().tag!==Syntax.endarray)
			ixs.push(this.expr())
		this.k++
		return this.emitSsa(`[${join(ixs)}]`)
	}
	case Syntax.app: {
		let ixs: string[] = []
		// generate strict arguments
		while (![Syntax.endapp, Syntax.applam].includes(this.nextIns().tag))
			ixs.push(this.expr())

		// For methods, fetch full name produced by tyck, otherwise the fun is first expression
		let fun = ins.metName !== null ?
			"_fixtures_."+this.itemCtx.tyck.getMethodSymbolAt(insLocation) :
			ixs.shift()

		// A contrived codegen spell indeed
		// Put no commas when no normal arguments are present
		// Put a comma after each normal argument since they are followed
		// by lambdas
		let genIx = this.emitSsa(`${fun}(${ixs.map(x=>x+",").join(" ")}`)

		// generate trailing lambdas
		while (true) {
		let ins = this.stepIns()
		if (ins.tag === Syntax.endapp) break
		assertEq(ins.tag, Syntax.applam)

		this.code.push(`  function*(${join(ins.ps)}) {\n`)
		let retIx = this.expr()
		this.code.push(`  return ${retIx}\n  },\n`)
		}

		this.code.push(`  );\n`)
		return this.emitYieldStar(genIx)
	}

	// types

	case Syntax.any:
		return `{tag:"any"}`
	case Syntax.arrow: {
		let domain: string[] = []
		while (this.nextIns().tag !== Syntax.endarrow)
			domain.push(this.expr())
		this.k++
		let codomain = this.expr()
		return `{tag:"arrow", domain:[${join(domain)}], codomain:${codomain}}`
	}
	default:
		nonExhaustiveMatch(ins.tag)
	}
	} catch (e) {
		if (e.constructor === CompileError) throw e
		throw new CompileError(this.ins().span, undefined, undefined, { cause: e })
	}
}

// list of key-value pairs to add to the global object
private codegen_(): ObjectMap<string> {
	try {
	this.itemCtx.tyck.tyck()
	let item = this.item
	let toplevels: ObjectMap<string> = Object.create(null)

	switch (item.tag) {
	case Syntax.cls: {
		let elimCode = []
		let ps = join(item.conss.map(x=>x.name))
		elimCode.push(`function*(self, ${ps}) {\n  switch (self.tag) {\n`)
		for (let c of item.conss) {
			let ps = c.fields.map(x=>x.name)
			let bs = join(ps)
			this.code.push(
				`function*(${bs}) {\n` +
				`  return {tag: Symbol.for("${c.name}"), ${bs}}\n}\n`)
			let as = join(ps.map(x=>"self."+x))
			//todo: eliminate yield*
			elimCode.push(
				`  case Symbol.for("${c.name}"): ` +
				`return yield* ${c.name}(${as});\n`)
			mapInsert(toplevels, item.name+"ᐅ"+c.name, this.unshiftCode())
		}
		elimCode.push(
			`  default: throw new Error("nonexhaustive: "` +
			` + self.tag.description)\n` +
			`  }\n}\n`)
		mapInsert(toplevels, item.name+"ᐅelim", elimCode.join(""))
		break
	}
	case Syntax.let: {
		this.code.push(`(function*() {\n`)
		let retIx = this.expr()
		this.code.push(`  return ${retIx}\n})().next().value`)
		mapInsert(toplevels, item.name, this.unshiftCode())
		break
	}
	case Syntax.fun: {
		let bs = item.bs.map(x=>x.name)
		this.code.push(`(function*(${join(bs)}) {\n`)
		let retIx2 = this.expr()

		this.code.push(`  return ${retIx2}\n})`)
		mapInsert(toplevels, this.itemCtx.getToplevelSymbol(), this.unshiftCode())
		break
	}
	case Syntax.nakedfun:
		this.code.push(`  return ${this.expr()}`)
		mapInsert(toplevels, "_", this.unshiftCode())
		break
	case Syntax.infixdecl:
		break
	default:
		nonExhaustiveMatch(item.tag)
	}
	return toplevels
	} catch (e) {
		if (e.constructor === CompileError) throw e
		throw new CompileError(this.item.span, undefined, undefined, { cause: e })
	}
}

codegen(): ObjectMap<string> {
	return this.itemCtx.network.memoize(
		"codegen-item", [], this.codegen_.bind(this))
}
}

export class RootCodegen {
	private code: string[] = [
		`"use strict";\n`,
		`const _fixtures_ = Object.create(null)\n`
	]

	addToplevels(cgs: ObjectMap<string>) {
		let toplevels = Object.entries(cgs).flatMap(
			([symbol, code]) => ["_fixtures_.", symbol, " = ", code, "\n"])
		this.code.push(...toplevels)
	}

	getCode(): string {
		this.code.push(`_fixtures_.main().next()`)
		return this.code.join("")
	}
}