import { assert, error, nonExhaustiveMatch, range, toString, unSingleton, write } from './util.ts'

import { Syntax } from "./syntax.ts"
import { Huk, RootTyck } from "./huk.ts"
import { ItemCodegen, RootCodegen } from "./codegen.ts"
import { Network } from './flow.ts'

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

	constructor(tyck: RootTyck, cg: RootCodegen | null,
		public network: Network, private item: any) {
		this.tyck = new Huk(this, tyck, item)
		this.cg = new ItemCodegen(this, cg, tyck, item)
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
}

export class Compiler {
private src: string
private logs: string[] = []
private tyck: RootTyck = new RootTyck()
private cg: RootCodegen = new RootCodegen()

constructor(
	src: string,
	private logging: boolean) {
		this.src = std + src
	}

static makeItemNetwork() {
	return new Network([
		"toplevel-symbols",
		"codegen-item",
	])
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
	return this.analyze(new Syntax(this.src).syntax())
}

private analyze(items: Iterable<any>) {
	try {
		for (let item of items) {
			let itemCtx = new ItemCtx(
				this.tyck, this.cg, Compiler.makeItemNetwork(), item)
			itemCtx.tyck.tyck()
			itemCtx.cg.step()
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