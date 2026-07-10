import { readFile } from 'node:fs/promises'

import { any, type ArrayMap, assert, error, mapGet, mapInsert, nonExhaustiveMatch, type ObjectMap, prettyPrint, range, toString, unexpectedMatch, unSingleton, write } from './util.ts'

import { InstrTag, Syntax, ToplevelTag, type Instr, type Toplevel } from './syntax.ts'
import { Huk, RootTyck } from './huk.ts'
import { ItemCodegen, RootCodegen } from './codegen.ts'
import { Network } from './flow.ts'
import { toposort } from './algorithms.ts'

const std = await readFile("./src/std.meml.rs", { encoding:"utf-8" })

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
		public network: Network, private item: Toplevel) {
		this.tyck = new Huk(this.compiler, this, rootTyck, item)
		this.cg = new ItemCodegen(this, cg, rootTyck, item)
	}

	// symbols introduced by this item
	private getToplevelSymbols_(): string[] {
		let item = this.item
		switch (item.tag) {
		case ToplevelTag.cls: {
			let symbol = item.name
			let symbols = [symbol, symbol+"ᐅelim"]
			for (let cons of item.conss)
				symbols.push(symbol+"ᐅ"+cons.name)
			return symbols
		}
		case ToplevelTag._let:
			return [item.name]
		case ToplevelTag.fun: {
			if (!item.isMethod)
				return [item.name]
			assert(item.bs.length >= 1, "methods shall have at least one parameter")

			let annotation = item.bs[0].type.arena
			let className: string
			switch (annotation[0].tag) {
				case InstrTag.use:
					className = annotation[0].name
					break
				case InstrTag.app:
					assert(annotation[1].tag===InstrTag.use,
						"1st parameter of a method shall be a class")
					className = any(annotation[1]).name
					break
				default:
					error("1st parameter of a method shall be a class")
			}
			return [className + "ᐅ" + item.name]
		}
		case ToplevelTag.typeexpr:
			error("type expression cannot have toplevel symbols")
			break // to please the linter
		case ToplevelTag.infixdecl:
			return []
		default:
			nonExhaustiveMatch(item satisfies never)
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

	let tabsize = 2
	let tab = ' '.repeat(tabsize)

	let lineNumber = 0
	for (let i of range(e.span)) if (this.src[i] === "\n") lineNumber++
	let lineNumberString = lineNumber + " | "

	// line begins after either line feed or -1
	let lineStart = this.src.lastIndexOf("\n", e.span) + 1
	let lineEnd = this.src.indexOf("\n", e.span)
	if (lineEnd === -1) lineEnd = this.src.length

	let unformattedLine = this.src.substring(lineStart, lineEnd)
	let formattedLine = unformattedLine.replaceAll('\t', tab)
	formattedLine = `\n${lineNumberString}${formattedLine}`

	// Count characters in line prefix. Tabs count for `tabsize` characters
	let charOffset = e.span - lineStart
	let cellOffset = 0
	for (let x of unformattedLine.substring(0, charOffset))
		cellOffset += x === '\t' ? tabsize : 1
	let underline = ' '.repeat(lineNumberString.length + cellOffset) + "^"

	write(`${formattedLine}
${underline}
CompileError: ${e.message}
Caused by:\n`)
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
		if (!(e instanceof CompileError)) throw e
		this.reportError(e)
		assert(e.cause!==undefined, "expected cause")
		throw e.cause
	}
}
}

function showExpr0(arena: Instr[], boxI: number[], builder: string[]) {
	let ins = arena[boxI[0]]
	boxI[0]++
	switch (ins.tag) {
	case InstrTag.strlit:
		builder.push(`"${ins.data}"`)
		break
	case InstrTag.native:
		builder.push(`native[|${ins.code}|]`)
		break
	case InstrTag.int:
		builder.push(toString(ins.data))
		break
	case InstrTag.array:
		builder.push("@[")
		if (arena[boxI[0]].tag!==InstrTag.endarray)
			showExpr0(arena, boxI, builder)
		while (arena[boxI[0]].tag!==InstrTag.endarray) {
			builder.push(" ")
			showExpr0(arena, boxI, builder)
		}
		boxI[0]++
		builder.push("]")
		break
	case InstrTag.any:
		builder.push("@any")
		break
	case InstrTag.arrow:
		builder.push("[")
		if (arena[boxI[0]].tag!==InstrTag.endarrow)
			showExpr0(arena, boxI, builder)
		while (arena[boxI[0]].tag!==InstrTag.endarrow) {
			builder.push(" ")
			showExpr0(arena, boxI, builder)
		}
		boxI[0]++
		builder.push("]")
		showExpr0(arena, boxI, builder)
		break
	case InstrTag.use:
		builder.push(ins.name)
		break
	case InstrTag.app:
		showExpr0(arena, boxI, builder)
		if (ins.metName !== null)
			builder.push(".", ins.metName)
		builder.push("(")
		if (![InstrTag.endapp, InstrTag.applam].includes(arena[boxI[0]].tag))
			showExpr0(arena, boxI, builder)
		while (![InstrTag.endapp, InstrTag.applam].includes(arena[boxI[0]].tag)) {
			builder.push(" ")
			showExpr0(arena, boxI, builder)
		}
		builder.push(")")
		while (arena[boxI[0]].tag===InstrTag.applam) {
			builder.push(" { ", any(arena[boxI[0]]).ps.join(" "), ". ")
			boxI[0]++
			showExpr0(arena, boxI, builder)
			builder.push(" }")
		}
		boxI[0]++
		break
	case InstrTag.endapp:
	case InstrTag.applam:
	case InstrTag.endarrow:
	case InstrTag.endarray:
		unexpectedMatch(ins); break
	default:
		nonExhaustiveMatch(ins satisfies never)
	}
}

export function showExpr(arena: Instr[], i: number) {
	let builder: string[] = []
	showExpr0(arena, [i], builder)
	return builder.join("")
}