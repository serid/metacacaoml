import { assert, range, toString, write } from './util.ts'

import { Syntax } from "./syntax.ts"
import { Huk, RootTyck } from "./huk.ts"
import { ItemCodegen, RootCodegen } from "./codegen.ts"
import { ItemNetwork } from './flow.ts'

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
	// reference to item itself is stored in each component
	// because pointer jumping
	tyck: Huk
	cg: ItemCodegen
	network: ItemNetwork

	constructor(network: ItemNetwork) {
		this.tyck = null
		this.cg = null
		this.network = network
	}

	init(tyck: RootTyck, cg: RootCodegen | null, item: any) {
		this.tyck = new Huk(this, tyck, item)
		this.cg = new ItemCodegen(this, cg, tyck, item)
	}

	reset() {
		this.tyck = null
		this.cg = null
		this.network.resetCache()
	}
}

export class Compiler {
src: string
logging: boolean
logs: string[]
tyck: RootTyck
cg: RootCodegen
itemCtx: ItemCtx

constructor(src: string, logging: boolean) {
	this.src = std + src
	this.logging = logging
	this.logs = []
	this.tyck = new RootTyck(this)
	this.cg = new RootCodegen(this)
	this.itemCtx = new ItemCtx(Compiler.makeItemNetwork())

	//this.tyck.initializeDucts(this.itemNetwork)
	//this.cg.initializeDucts(this.itemNetwork)
}

static makeItemNetwork()  {
	return new ItemNetwork([
		"codegen-item",
	])
}

log(...xs: any[]) {
	if (!this.logging) return
	write(...xs)
	for (let x of xs) this.logs.push(toString(x), " ")
	this.logs.push("\n\n")
}

reportError(e: CompileError) {
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
		return this.analyze(new Syntax(this).syntax())
	} catch (e) {
		//console.log(this.logs)
		throw e
	}
}

analyze(items: Iterable<any>) {
	try {
		for (let item of items) {
			this.itemCtx.init(this.tyck, this.cg, item)
			this.itemCtx.tyck.tyck()
			this.itemCtx.cg.step()

			this.itemCtx.reset()
		}

		this.log(`normalizations count: ` + this.tyck.normalCounter)
		return this.cg.getCode()
	} catch (e) {
		if (e.constructor !== CompileError) throw e
		// this.log("analyze", item)
		this.reportError(e)
		assert(e.cause!==undefined, "expected cause")
		throw e.cause
	}
}
}