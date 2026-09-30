import { basename, join } from 'node:path'

import { any, type ArrayMap, assert, chain, error, map, mapGet, mapInsert, nonExhaustiveMatch, type ObjectMap, prettyPrint, range, toString, unexpectedMatch, unSingleton, write } from './util.ts'

import { toposort } from './algorithms.ts'
import { ItemCodegen, RootCodegen } from './codegen.ts'
import { Network } from './flow.ts'
import { Huk, RootTyck } from './huk.ts'
import { foldDirectory } from './node-util.ts'
import { type Digest, digestAlgorithm, digestTiming, getFile, QueryCache } from './query-cache.ts'
import { InstrTag, parse, type Span, type Toplevel, ToplevelTag } from './syntax.ts'

export class CompileError extends Error {
	constructor(public span: Span, public log: string = "", message?: string,
		options?: ErrorOptions) {
		super(message, options)
	}
}

export type PackageSource = { path: string, name: string, content: Module }
export type Module = ObjectMap<ModuleEntry>
export type ModuleEntry =
	| { tag: "file", path: string, text: string }
	| { tag: "module", path: string, entries: Module }

export async function readPackageSourceFromFs(dirPath: string): Promise<PackageSource> {
	let name = basename(dirPath)
	let content = await foldDirectory<Module>(dirPath, (files, directories) => {
		let files1: Iterable<[string, ModuleEntry]> = map(files, ([path, name, text]) => [name, {
			tag: "file",
			path,
			text
		}])
		let directories1: Iterable<[string, ModuleEntry]> = map(directories, ([path, name, entries]) => [name, {
			tag: "module",
			path,
			entries
		}])
		return Object.fromEntries(chain(files1, directories1))
	})
	return { path: dirPath, name, content }
}

export function resolveModPath(
		packageNameToPath: ObjectMap<string>, pkgName: string, modPath: string
		): string {
	return join(mapGet(packageNameToPath, pkgName), modPath)
}

export class ItemCtx {
	// reference to item itself is additionally stored in each component
	// because pointer jumping
	tyck: Huk
	cg: ItemCodegen

	constructor(
		private compiler: Compiler,
		private rootTyck: RootTyck, cg: RootCodegen | null,
		public network: Network,
		private item: Toplevel,
		d: Digest) {
		this.tyck = new Huk(compiler.qc, compiler, this, rootTyck, item, d)
		this.cg = new ItemCodegen(compiler.qc, this, cg, rootTyck, item, d)
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
	ensureFixtureDependencies(): void {
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

	addFixtures(): void {
		this.network.memoizeWithResolver(
			"add-fixtures", [], this.addFixtures_.bind(this))
	}
}

export class Compiler {
private logs: string[] = []
private tyck: RootTyck = new RootTyck()
private cg: RootCodegen = new RootCodegen()
public qc: QueryCache
private pathToFileDigest: ObjectMap<Digest> = Object.create(null)
private packageNameToPath: ObjectMap<string> = Object.create(null)

// key is itemid
itemCtxOfItemId: ArrayMap<ItemCtx> = []
// symbol is a global name after mangling
symbolToItemId: ObjectMap<number> = Object.create(null)

constructor(
	private src: PackageSource,
	private logging: boolean) {
		function go(m: Module,
			pathToFileDigest: ObjectMap<Digest>,
			insertFile: (entry: { path: string, text: string }) => Digest,
		): void {
			for (let entry of Object.values(m)) {
				if (entry.tag === "module")
					go(entry.entries, pathToFileDigest, insertFile)
				if (entry.tag !== "file") unexpectedMatch(entry.tag)

				// File digest depends on path as file analysis is dependent on its path
				// since it defines what names are available and is used in error messages
				let d = insertFile({ path: entry.path, text: entry.text })
				mapInsert(pathToFileDigest, entry.path, d)
			}
		}

		this.qc = new QueryCache([
				"preparse",
				"resolve-imports",
				"parse-from",
				"parse",
				"assert-infix-import-acyclicity",
				"get-toplevel-symbols",
			],
			[
				"file",
				"item"
			],
		)

		let insertFile = (entry: { path: string, text: string }) =>
			this.qc.casAdd("file", entry, entry.path)
		go(src.content, this.pathToFileDigest, insertFile)

		mapInsert(this.packageNameToPath, src.name, src.path)
	}

static makeItemNetwork(): Network {
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

log(...xs: any[]): void {
	if (!this.logging) return
	write(...xs)
	for (let x of xs) this.logs.push(toString(x), " ")
	this.logs.push("\n\n")
}

private reportError(e: CompileError): void {
	if (this.logging) write(e.log)

	let { path, text } = getFile(this.qc, e.span.file)
	let offset = e.span.offset

	let tabsize = 2
	let tab = ' '.repeat(tabsize)

	let lineNumber = 0
	for (let i of range(offset)) if (text[i] === "\n") lineNumber++
	let lineNumberString = lineNumber + " | "

	// line begins after either line feed or -1
	let lineStart = text.lastIndexOf("\n", offset) + 1
	let lineEnd = text.indexOf("\n", offset)
	if (lineEnd === -1) lineEnd = text.length

	let unformattedLine = text.substring(lineStart, lineEnd)
	let formattedLine = unformattedLine.replaceAll('\t', tab)
	formattedLine = `\n${lineNumberString}${formattedLine}`

	// Count characters in line prefix. Tabs count for `tabsize` characters
	let charOffset = offset - lineStart
	let cellOffset = 0
	for (let x of unformattedLine.substring(0, charOffset))
		cellOffset += x === '\t' ? tabsize : 1
	let underLinePrefix = ' '.repeat(lineNumberString.length + cellOffset)
	let fileCrumb = path
	let underline = `${underLinePrefix}^ (in '${fileCrumb}')`

	write(`${formattedLine}
${underline}
CompileError: ${e.message}
Caused by:\n`)
}

compile(): string {
	try {
		let items: Toplevel[] = []

		// todo: make typechecking and codegen pure and independent of processing
		// order. In final target code concatenation order matters for let
		// definitions because they execute top down.
		let files = Object.entries(this.pathToFileDigest)
		files.sort((x, y) => x[0] < y[0] ? -1 : 1)
		// todo: nested modules
		for (let [_path, file] of files) {
			let [toplevels, _hereInfixExports] =
				parse(this.qc, file, this.packageNameToPath, this.pathToFileDigest)
			items.push(...toplevels)
		}

		for (let item of items) {
			let d = this.qc.casAdd("item", item, "@compile")
			let itemCtx = new ItemCtx(
				this, this.tyck, this.cg, Compiler.makeItemNetwork(), item, d)
			for (let symbol of getToplevelSymbols(this.qc, d))
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
		this.log(`${digestAlgorithm} hashing time:`, digestTiming, `ms`)
		return this.cg.getCode()
	} catch (e) {
		if (!(e instanceof CompileError)) throw e
		this.reportError(e)
		if (e.cause !== undefined) throw e.cause
		else throw e
	}
}
}

// Symbols introduced by an item
function getToplevelSymbols0(qc: QueryCache, item0: Digest): string[] {
	let item: Toplevel = qc.casGet("item", item0)
	switch (item.tag) {
	case ToplevelTag.axiom:
		return [item.name]
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

export function getToplevelSymbols(qc: QueryCache, item: Digest): string[] {
	// Digest already available. Collapse ['hash'] to 'hash' and skip secondary rehashing.
	return qc.getOrComputeKnownDigest("get-toplevel-symbols", [item], item, getToplevelSymbols0)
}

export function getToplevelSymbol(qc: QueryCache, item: Digest): string {
	return unSingleton(getToplevelSymbols(qc, item))
}