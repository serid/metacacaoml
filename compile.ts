import { ArrayMap, assert, error, mapGet, mapInsert, nonExhaustiveMatch, ObjectMap, prettyPrint, range, toString, unSingleton, write } from './util.ts'

import { Syntax } from "./syntax.ts"
import { Huk, RootTyck } from "./huk.ts"
import { ItemCodegen, RootCodegen } from "./codegen.ts"
import { Network } from './flow.ts'
import { toposort } from './algorithms.ts'

const std = await globalThis.Deno.readTextFile("./std.meml.rs")

export class CompileError extends Error {
	log: string
	span: number

	constructor(span: number, log?: string, message?: string,
		options?: ErrorOptions) {
		super(message, options)
		this.log = log ?? ""
		this.span = span
	}
}

export class ItemCtx {
	// reference to item itself is additionally stored in each component
	// because pointer jumping
	tyck: Huk
	cg: ItemCodegen

	constructor(private compiler: Compiler,
		private rootTyck: RootTyck, cg: RootCodegen | null,
		public network: Network, private item: any) {
		this.tyck = new Huk(this.compiler, this, rootTyck, item)
		this.cg = new ItemCodegen(this, cg, rootTyck, item)
	}

	// symbols introduced by this item
	private getToplevelSymbols_(): string[] {
		let item = this.item
		switch (item.tag) {
		case Syntax.cls: {
			let symbol = item.name
			let symbols = [symbol, symbol+"ᐅelim"]
			for (let cons of item.conss)
				symbols.push(symbol+"ᐅ"+cons.name)
			return symbols
		}
		case Syntax.let:
			return [item.name]
		case Syntax.fun: {
			if (!item.isMethod)
				return [item.name]
			assert(item.bs.length >= 1, "methods shall have at least one parameter")

			let annotation = item.bs[0].type.arena
			let className: string
			switch (annotation[0].tag) {
				case Syntax.use:
					className = annotation[0].name
					break
				case Syntax.app:
					assert(annotation[1].tag===Syntax.use, "1st parameter of a method shall be a class")
					className = annotation[1].name
					break
				default:
					error("1st parameter of a method shall be a class")
			}
			return [className + "ᐅ" + item.name]
		}
		case Syntax.nakedfun:
			error("naked fun has no toplevel symbols")
			break // to please the linter
		default:
			nonExhaustiveMatch(item.tag)
		}

	}

	getToplevelSymbols(): string[] {
		return this.network.memoize("toplevel-symbols", [],
			this.getToplevelSymbols_.bind(this))
	}

	getToplevelSymbol(): string {
		return unSingleton(this.getToplevelSymbols())
	}

	// jit compile and close the code with a _fixtures_ object
	private jitCompile(code: string): Function {
		try {
		code = `"use strict";\nreturn ` + code
		return new Function("_fixtures_", code)(this.rootTyck.fixtures)
		} catch (e) {
			let log = `Env: ${prettyPrint(this.rootTyck.fixtures)}\n` +
				`Obj: ${code}`
			throw new CompileError(this.item.span, log, undefined, { cause: e })
		}
	}

	// only used for fixture dependencies
	ensureFixtureDependencies() {
		this.tyck.tyck()
		for (let symbol of this.tyck.getSymbolicDependencies())
			this.compiler.itemCtxOfSymbol(symbol).addFixtures()
	}

	addFixtures_(resolve: (_: null) => void): null {
		// Resolve early to allow recursive functions
		// note: if it were to resolve with undefined,
		// the network would recompute indefinetely, so we use a null singleton
		resolve(null)
		this.ensureFixtureDependencies()

		let cgs = this.cg.codegen()
		for (let cgSymbol in cgs)
			mapGet(this.rootTyck.globals, cgSymbol).value.setIfUnsetThen(
				()=>this.jitCompile(cgs[cgSymbol])
			)
		return null
	}

	addFixtures() {
		this.network.memoizeWithResolver(
			"add-fixtures", [], this.addFixtures_.bind(this))
	}
}

export class Compiler {
private src: string
private logs: string[] = []
private tyck: RootTyck = new RootTyck()
private cg: RootCodegen = new RootCodegen()

// key is itemid
itemCtxOfItemId: ArrayMap<ItemCtx> = []
// symbol is a global name after mangling
symbolToItemId: ObjectMap<number> = Object.create(null)

constructor(
	src: string,
	private logging: boolean) {
		this.src = std + src
	}

static makeItemNetwork() {
	return new Network([
		"toplevel-symbols",
		"codegen-item",
		"tyck-item",
		"add-fixtures",
	])
}

itemCtxOfSymbol(symbol: string): ItemCtx {
	let id = mapGet(this.symbolToItemId, symbol)
	return this.itemCtxOfItemId[id]
}

log(...xs: any[]) {
	if (!this.logging) return
	write(...xs)
	for (let x of xs) this.logs.push(toString(x), " ")
	this.logs.push("\n\n")
}

private reportError(e: CompileError) {
	if (this.logging) write(e.log)

	let lineNumber = 0
	for (let i of range(e.span)) if (this.src[i] === "\n") lineNumber++
	let lineNumberString = lineNumber + " | "

	// line begins after either line feed or -1
	let lineStart = this.src.lastIndexOf("\n", e.span) + 1
	let lineEnd = this.src.indexOf("\n", e.span)
	if (lineEnd === -1) lineEnd = this.src.length
	write(lineNumberString + this.src.substring(lineStart, lineEnd))
	write(" ".repeat(lineNumberString.length + (e.span - lineStart)) + "^")
}

compile() {
	try {
		let items = [...new Syntax(this.src).syntax()]

		for (let item of items) {
			let itemCtx = new ItemCtx(
				this, this.tyck, this.cg, Compiler.makeItemNetwork(), item)
			for (let symbol of itemCtx.getToplevelSymbols())
				mapInsert(this.symbolToItemId, symbol, this.itemCtxOfItemId.length)
			this.itemCtxOfItemId.push(itemCtx)
		}

		// Typecheck all
		for (let itemCtx of this.itemCtxOfItemId) {
			itemCtx.tyck.tyck()
		}

		// Generate code for all
		let ctxEdges = (ctx: ItemCtx) =>
			ctx.tyck.getSymbolicDependencies()
				.map(symbol=>mapGet(this.symbolToItemId, symbol))
		for (let itemCtx of toposort(this.itemCtxOfItemId, ctxEdges)) {
			if (!itemCtx.tyck.tyck()) continue
			this.cg.addToplevels(itemCtx.cg.codegen())
		}

		this.log(`normalizations count: ` + this.tyck.normalCounter)
		return this.cg.getCode()
	} catch (e) {
		if (e.constructor !== CompileError) throw e
		this.reportError(e)
		assert(e.cause!==undefined, "expected cause")
		throw e.cause
	}
}
}