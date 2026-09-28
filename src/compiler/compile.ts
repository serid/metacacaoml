import { basename, join } from 'node:path'

import { any, type ArrayMap, assert, chain, error, map, mapGet, mapInsert, nonExhaustiveMatch, type ObjectMap, prettyPrint, range, toString, unexpectedMatch, unSingleton, write } from './util.ts'

import { toposort, toposortAcyclic } from './algorithms.ts'
import { ItemCodegen, RootCodegen } from './codegen.ts'
import { Network } from './flow.ts'
import { Huk, RootTyck } from './huk.ts'
import { foldDirectory } from './node-util.ts'
import { type Digest, digest, QueryCache } from './query-cache.ts'
import { type InfixDecl, InstrTag, parse, preparse, type PreparseResult, type Span, type Toplevel, ToplevelTag } from './syntax.ts'

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

function resolveModPath(
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
		public network: Network, private item: Toplevel) {
		this.tyck = new Huk(this.compiler, this, rootTyck, item)
		this.cg = new ItemCodegen(this, cg, rootTyck, item)
	}

	// symbols introduced by this item
	private getToplevelSymbols_(): string[] {
		let item = this.item
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
private qc: QueryCache
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
			files: ObjectMap<[Digest, string]>,
			pathToFileDigest: ObjectMap<Digest>,
		): void {
			for (let [name, entry] of Object.entries(m)) {
				if (entry.tag === "module") go(entry.entries, files, pathToFileDigest)
				if (entry.tag !== "file") unexpectedMatch(entry.tag)

				// File digest depends on path as file analysis is dependent on its path
				// since it defines what names are available and is used in error messages
				let d = digest(`${entry.path}:${entry.text}`)
				d = name + d
				mapInsert(files, d, [entry.path, entry.text])
				mapInsert(pathToFileDigest, entry.path, d)
			}
		}

		let files: ObjectMap<[Digest, string]> = Object.create(null)
		go(src.content, files, this.pathToFileDigest)

		this.qc = new QueryCache([
				"preparse",
				"parse",
			],
			files
		)
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

	let [path, text] = this.qc.getFile(e.span.file)
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
		// Compute a topological order induced by files importing one another
		let order: Digest[]
		let preparses: ObjectMap<PreparseResult<string>>
		{
			let fileDigests = this.qc.getFiles()
			let preparses0 = fileDigests.map(file => {
				let pr: PreparseResult<any> = preparse(this.qc, file)
				let infixImportFiles =
					pr.il.infixImportFiles.map(([pkg, modPath]: any) =>
						resolveModPath(this.packageNameToPath, pkg, modPath))
				return [file, { il: { infixImportFiles }, offset: pr.offset }]
			})

			preparses = Object.fromEntries(preparses0)
			let edges = (file: Digest) =>
				mapGet(preparses, file).il.infixImportFiles.map(importPath => {
					let importedDigest = mapGet(this.pathToFileDigest, importPath)
					let ix = fileDigests.indexOf(importedDigest)
					assert(ix !== -1)
					return ix
				})
			order = [...toposortAcyclic(fileDigests, edges)]
		}

		let infixDecls: InfixDecl[] = []
		let items: Toplevel[] = []

		// todo: nested modules
		for (let file of order) {
			let offset = mapGet(preparses, file).offset
			let [toplevels, moreInfixDecls] =
				parse(this.qc, file, offset, infixDecls)
			items.push(...toplevels)
			infixDecls = moreInfixDecls
		}

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
		if (e.cause !== undefined) throw e.cause
		else throw e
	}
}
}