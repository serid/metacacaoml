import { error, assert, assertL, assertEq, nonExhaustiveMatch, mapInsert, nextLast, findUniqueIndex, map, filter, join, GeneratorFunction, type ObjectMap, mapGet, LateInit, prettyPrint, mapRemove, mapFilterMapProjection, first, zip, view, Dexterity, flipHands, range, write, every, exceptionCauses, any, unexpectedMatch, assertDefined } from './util.ts'

import { InstrTag, ToplevelTag, type Constructor, type Instr, type Toplevel, type TypeExpr } from './syntax.ts'
import { CompileError, Compiler, ItemCtx, showExpr } from './compile.ts'

//! Implements typechecking using an algorithm from
//! https://arxiv.org/abs/1306.6032
//! simplified to omit higher-rank polymorphism

type Type =
	| { tag: "any" }
	| { tag: "use", name: string }
	| { tag: "euse", name: string }
	| { tag: "cons", fullName: string, args: Type[] }
	| { tag: "arrow", domain: Type[], codomain: Type }

type CtxItem =
	| { tag: "uni", name: string }
	| { tag: "var", name: string, ty: Type }
	| { tag: "evar", name: string }
	| { tag: "esolve", name: string, solution: Type }
	| { tag: "mark", id: number }

function showType(ty: Type): string {
	if (ty===undefined||ty===null) return String(ty)
	switch (ty.tag) {
	case "any":
		return "any"
	case "use":
		return ty.name
	case "euse":
		return "?" + ty.name
	case "cons":
		return `${ty.fullName}(${ty.args.map(showType).join(" ")})`
	case "arrow":
		return `[${ty.domain.map(showType).join(" ")}]` + showType(ty.codomain)
	default:
		return prettyPrint(ty)
	}
}

const useType: Type = {tag: "cons", fullName: "Type", args: []}

function mkUse(name: string): Type {
	return {tag:"use",name}
}

function mkEUse(name: string): Type {
	return {tag:"euse",name}
}

function mkEVar(name: string): CtxItem {
	return {tag:"evar",name}
}

// The item typechecker, named after Yenisei
export class Huk {
private k: number = 0
private ctx: CtxItem[] = []

// log of typing judgements applied
private depth: number = 0
private log: string[] = []

// Codegen will be querying the methodname
private methodSymbolAt: ObjectMap<string> = Object.create(null)

// This item depends on these meml symbols to run
private symbolicDependencies: string[] = []

constructor(
	private compiler: Compiler,
	private itemCtx: ItemCtx,
	private root: RootTyck, // toplevel tycker
	private item: Toplevel) {}

private arena(): Instr[] {
	return any(this.item).arena
}

private ins() {
	return this.arena()[Math.max(this.k-1, 0)]
}

private nextIns() {
	return this.arena()[this.k]
}

private stepIns() {
	return this.arena()[this.k++]
}

// invent a name like hint but not present in "taken"
private static invent(hint: string, taken: string[]) {
	while (taken.includes(hint)) {
		let [_, alpha, num] =
			hint.match(/(\D*)(\d*)/)!
		let numstr = num===""?"0":parseInt(num,10)+1
		hint = alpha + numstr
	}
	return hint
}

private showCtx() {
	let s = map(this.ctx, x => {
		switch (x.tag) {
		case "uni": return x.name
		case "var": return `${x.name}: ${showType(x.ty)}`
		case "evar": return `?${x.name}`
		case "esolve": return `?${x.name} = ${showType(x.solution)}`
		case "mark": return `m${x.id}`
		default: return prettyPrint(x)
		}
	})
	return join(s)
}

private pushTyping(s: string) {
	this.log.push("  ".repeat(this.depth) + s)
}

private pushCtx() {
	this.pushTyping("\x1b[33m" + this.showCtx() + "\x1b[0m")
}

private enterTyping(s: string) {
	this.pushTyping(s)
	this.depth++
}

private exitTyping(s: string) {
	this.depth--
	this.pushTyping(s)
	this.pushCtx()
}

private addTyping(s: string) {
	this.pushTyping(s)
	this.pushCtx()
}

getMethodSymbolAt(insLocation: number) {
	return mapGet(this.methodSymbolAt, insLocation)
}

getSymbolicDependencies() {
	return this.symbolicDependencies
}

// normalization by jit compilation
private normalize(tyExpr: TypeExpr): any {
	try {
	assertEq(tyExpr.tag, ToplevelTag.typeexpr)

	this.root.normalCounter++
	// prepare environment (it will be passed in params)
	let env = Object.create(null)
	env._fixtures_ = this.root.fixtures
	for (let x of this.ctx) {
		if (x.tag === "uni")
			env[x.name] = mkUse(x.name)
	}
	let envv = Object.entries(env)
	let paramNames = envv.map(x=>x[0])
	let args = envv.map(x=>x[1])

	let nakedCtx = new ItemCtx(
		this.compiler, this.root, null, Compiler.makeItemNetwork(), tyExpr)

	//kinda hacky idk
	nakedCtx.tyck.ctx = [...this.ctx]

	nakedCtx.ensureFixtureDependencies()
	let cgs = nakedCtx.cg.codegen()
	assertEq(Object.keys(cgs), ["_"])
	let obj = `  "use strict";\n` + cgs._
	// write(`Normalization №${this.root.normalCounter} Obj:\n${cgs._}\n`)

	try {
		let g = new GeneratorFunction(...paramNames, obj)(...args)
		let normalized = nextLast(g)
		return normalized
	} catch (e) {
		let log = `Env: ${prettyPrint(env)}\n` +
			`Obj: function*(${join(paramNames)}) {\n${obj}\n}`
		throw new CompileError(tyExpr.span, log, undefined, { cause: e })
	}
	} catch (e) {
		if (e instanceof CompileError) throw e
		throw new CompileError(tyExpr.span, undefined, undefined, { cause: e })
	}
}

private getTakenEVarNames(): string[] {
	return [...map(filter(this.ctx, x=>
		x.tag === "evar" || x.tag === "esolve"),
		x=>any(x).name)]
}

private inventEVars(hint: string, how_many: number): string[] {
	let taken = this.getTakenEVarNames()
	let inventions = []
	for (let _ of range(how_many)) {
		let name = Huk.invent(hint, taken)
		taken.push(name)
		inventions.push(name)
	}
	return inventions
}

private inventEVarsFromHints(hints: string[]): string[] {
	let taken = this.getTakenEVarNames()
	let inventions = []
	for (let hint of hints) {
		let name = Huk.invent(hint, taken)
		taken.push(name)
		inventions.push(name)
	}
	return inventions
}

private allocEVar(hint: string) {
	let name = Huk.invent(hint, this.getTakenEVarNames())
	this.ctx.push(mkEVar(name))
	return name
}

// Replace universal variables with existentials
private instantiate(vars: string[], ty: Type) {
	this.enterTyping(`|- inst(${prettyPrint(vars)}, ${showType(ty)})`)

	// generate fresh evar names
	let mapp = Object.create(null)
	let inventions = this.inventEVarsFromHints(vars)
	for (let [uniName, evar] of zip(vars, inventions))
		mapp[uniName] = evar
	this.ctx.push(...inventions.map(mkEVar)/*.reverse()*/)

	let ty1 = Huk.instantiate0(mapp, ty)
	this.exitTyping(`-| inst(${prettyPrint(vars)}, ${showType(ty)}) -> ${showType(ty1)}`)
	return ty1
}

private static instantiate0(varMap: ObjectMap<string>, ty: Type): Type {
	switch (ty.tag) {
	case "cons":
		return {tag: "cons",
			fullName: ty.fullName,
			args: ty.args.map(this.instantiate0.bind(this, varMap))
		}
	case "arrow":
		return {tag: "arrow",
			domain: ty.domain.map(this.instantiate0.bind(this, varMap)),
			codomain: this.instantiate0(varMap, ty.codomain)
		}
	case "use": {
		let name = varMap[ty.name]
		if (name === undefined) return ty
		return mkEUse(name)
	}
	case "any":
	case "euse":
		return ty
	default:
		nonExhaustiveMatch(ty satisfies never)
	}
}

// bidir.pdf: [Г]A
private substitute(ty: Type): Type {
	//this.addTyping(`[${this.showCtx()}]${showType(ty)}`)
	switch (ty.tag) {
	case "any":
	case "use":
		return ty
	case "euse": {
		let ix = findUniqueIndex(this.ctx, x=>
			x.tag === "esolve" && x.name === ty.name)
		if (ix !== -1)
			return this.substitute(any(this.ctx[ix]).solution)

		// evar not solved, but is it even declared?
		ix = findUniqueIndex(this.ctx, x => x.tag === "evar" && x.name === ty.name)
		assert(ix !== -1, "evar not found") // invariant
		return ty
	}
	case "cons":
		return {tag: "cons",
			fullName: ty.fullName,
			args: ty.args.map(this.substitute.bind(this))
		}
	case "arrow":
		return {tag: "arrow",
			domain: ty.domain.map(this.substitute.bind(this)),
			codomain: this.substitute(ty.codomain)
		}
	default:
		nonExhaustiveMatch(ty satisfies never)
	}
}

// Known as "InstantiateL/InstantiateR" in paper
// Left, alpha <:= other
// or
// Right, other <=: alpha
//
// EVar solving is very sensitive to order in which evars occur in context.
// I still don't know what structure this order obeys and how Jana and Neel
// arrived at it, but it seems that making an arrow of evars allocates the evars
// in reverse order in context, see InstLArr
private instantiateEvar(direction: Dexterity, alpha: string, other: Type) {
	switch (direction) {
	case Dexterity.Left:
		this.addTyping(`|- ?${alpha} <:= ${showType(other)}`); break
	case Dexterity.Right:
		this.addTyping(`|- ${showType(other)} <=: ?${alpha}`); break
	}
	assert(!this.ctx.some(
		x => x.tag === "esolve" && x.name === alpha),
		"evar already solved") // invariant

	let ix = findUniqueIndex(this.ctx,
		x => x.tag === "evar" && x.name === alpha)
	assert(ix !== -1, `evar ?${alpha} not found`) // invariant

	switch (other.tag) {
	case "euse": {
		// If other is also an evar use, then we're doing either
		// InstLSolve or InstLReach (or the R versions).
		// What these rules effectively do is find whichever evar is
		// further in context and solve it to firster evar.
		let ix2 = findUniqueIndex(this.ctx,
			x => x.tag === "evar" && x.name === other.name)
		assert(ix2 !== -1, `evar ?${other.name} not found`) // invariant

		if (ix < ix2)
			// Inst(L|R)Reach
			this.ctx[ix2] = {tag: "esolve", name: any(this.ctx[ix2]).name,
				solution: mkEUse(alpha)}
		else
			// Inst(L|R)Solve
			this.ctx[ix] = {tag: "esolve", name: alpha, solution: other}
		break
	}
	case "arrow": {
		// why is codomain first?
		// should domain elements be reversed too?
		let inventions = this.inventEVars("Y", other.domain.length + 1)

		let domain_names = [...inventions]
		let codomain_name = assertDefined(domain_names.pop())

		let ctxSnippet = inventions.map(mkEVar)
		ctxSnippet.reverse()
		ctxSnippet.push({tag: "esolve", name: alpha, solution: {
			tag: "arrow",
			domain: domain_names.map(mkEUse),
			codomain: mkEUse(codomain_name)
		}})
		this.ctx.splice(ix, 1, ...ctxSnippet)

		for (let [evar, param] of zip(domain_names, other.domain)) {
			// new information may have been generated by previous steps
			param = this.substitute(param)
			// note the contravariant twist for arrow domain
			this.instantiateEvar(flipHands(direction), evar, param)
		}
		let codomain = this.substitute(other.codomain)
		this.instantiateEvar(direction, codomain_name, codomain)
		break
	}
	case "cons": {
		// designed based on the arrow case
		let arg_names = this.inventEVars("K", other.args.length)

		let ctxSnippet = arg_names.map(mkEVar)
		ctxSnippet.reverse()
		ctxSnippet.push({tag: "esolve", name: alpha, solution: {
			tag: "cons",
			fullName: other.fullName,
			args: arg_names.map(mkEUse)
		}})
		this.ctx.splice(ix, 1, ...ctxSnippet)

		for (let [evar, arg] of zip(arg_names, other.args)) {
			// new information may have been generated by previous steps
			arg = this.substitute(arg)
			this.instantiateEvar(direction, evar, arg)
		}
		break
	}
	default:
		this.ctx[ix] = {tag: "esolve", name: alpha, solution: other}
	}
}

private subtype_(ty1: Type, ty2: Type) {
	if (ty1.tag === "euse" &&
		ty2.tag === "euse" &&
		ty1.name === ty2.name)
		return
	if (ty1.tag === "euse") {
		//todo: occurs check
		this.instantiateEvar(Dexterity.Left, ty1.name, ty2)
		return
	}
	if (ty2.tag === "euse") {
		//todo: occurs check
		this.instantiateEvar(Dexterity.Right, ty2.name, ty1)
		return
	}
	if (ty1.tag === "any" || ty2.tag === "any")
		return

	switch (ty1.tag) {
	case "use":
		assert(ty2.tag === "use" && ty1.name === ty2.name)
		break
	case "cons":
		if (ty2.tag !== "cons") error()
		assertEq(ty1.fullName, ty2.fullName)
		for (let [x, y] of zip(ty1.args, ty2.args)) {
			// new information may have been generated by previous steps
			x = this.substitute(x)
			y = this.substitute(y)
			this.subtype(x, y)
		}
		break
	case "arrow": {
		if (ty2.tag !== "arrow") error()
		assert(ty1.domain.length === ty2.domain.length)
		for (let [x, y] of zip(ty1.domain, ty2.domain)) {
			// new information may have been generated by previous steps
			x = this.substitute(x)
			y = this.substitute(y)
			this.subtype(y, x) // note the contravariant twist for arrow domain
		}
		let cd1 = this.substitute(ty1.codomain)
		let cd2 = this.substitute(ty2.codomain)
		this.subtype(cd1, cd2)
		break
	}
	default:
		nonExhaustiveMatch(ty1 satisfies never)
	}
}

private subtype(ty1: Type, ty2: Type) {
	this.enterTyping(`|- ${showType(ty1)} <: ${showType(ty2)}`)
	this.subtype_(ty1, ty2)
	this.exitTyping(`-| ${showType(ty1)} <: ${showType(ty2)}`)
}

private subtypeUi(ty1: Type, ty2: Type) {
	try {
		this.subtype(ty1, ty2)
	} catch (e) {
		assert(!(e instanceof CompileError))
		throw new CompileError(this.ins().span, this.log.join("\n"),
			`error: \`${showType(ty1)}' is not a subtype of \`${showType(ty2)}'`,
			{ cause: e })
	}
}

private ensureGlobalTyckedAndInstantiate(symbol: string, msg: string): Type {
	this.symbolicDependencies.push(symbol)

	let gb = this.root.globals[symbol]
	ensure: {
		// short circuit
		if (gb !== undefined) break ensure

		// try looking in global symbols, if present, request it to be compiled
		let itemCtx = this.compiler.itemCtxOfSymbol(symbol)
		assert(itemCtx !== undefined, msg)
		itemCtx.tyck.tyck()

		gb = this.root.globals[symbol]
		assert(gb !== undefined)
	}
	return this.instantiate(gb.gs, gb.ty)
}

// Shared algorithm body for lambda checking and synthesis
private lambdaCheckOrInfer(ty: Type, ps: string[]) {
	if (ty.tag !== "arrow") error()
	assertEq(ty.domain.length, ps.length)

	// Introduce a marker to stack to clean up everything after it when
	// body tyck concludes.
	// ID is index of first instruction in lambda, though it could be anything as
	// long as each lambda gets a unique one within a function tyck.
	let id = this.k
	this.ctx.push({
		tag: "mark",
		id
	})

	for (let [p, pTy] of zip(ps, ty.domain)) {
		this.ctx.push({
			tag: "var",
			name: p,
			ty: pTy
		})
	}
	this.check(ty.codomain)

	// Remove from context the prepared marker and everything after it
	// including vars and body tyck remnants
	// Evars introduced for arrow remain
	let ix = this.ctx.findLastIndex(x =>
		x.tag === "mark" &&
		x.id === id)
	assert(ix >= 0) // invariant
	this.ctx.splice(ix, this.ctx.length - ix)
}

private infer_(): Type {
	let insLocation = this.k
	let ins = this.stepIns()
	switch (ins.tag) {
	case InstrTag.strlit:
		return {tag:"cons", fullName:"String", args:[]}
	case InstrTag.native:
		return {tag: "any"}
	case InstrTag.int:
		return {tag:"cons", fullName:"Int", args:[]}
	case InstrTag.use: {
		// try finding a uni
		if (this.ctx.findLastIndex(x=>
			x.tag === "uni" && x.name === ins.name) !== -1)
			return useType
		// try finding a local
		let ix = this.ctx.findLastIndex(x=>
			x.tag === "var" && x.name === ins.name)
		if (ix !== -1)
			return any(this.ctx[ix]).ty

		return this.ensureGlobalTyckedAndInstantiate(ins.name, "var not found")
	}
	case InstrTag.array: {
		// if array is empty, element type is a fresh evar, otherwise infer
		let elementTy = this.nextIns().tag===InstrTag.endarray ?
			mkEUse(this.allocEVar("Arr")) :
			this.infer()

		while (this.nextIns().tag!==InstrTag.endarray)
			this.check(elementTy)
		this.k++

		return {tag:"cons", fullName:"Array", args:[elementTy]}
	}
	case InstrTag.app: {
		let isMethod = ins.metName !== null
		let fty: Type
		if (!isMethod)
			fty = this.infer()
		else {
			let receiver = this.infer()
			assertEq(receiver.tag, "cons")

			let methodSymbol = any(receiver).fullName+"ᐅ"+ins.metName
			mapInsert(this.methodSymbolAt, insLocation, methodSymbol)

			fty = this.ensureGlobalTyckedAndInstantiate(
				methodSymbol, "method not found")
			if (fty.tag !== "arrow") error()
			assert(fty.domain.length > 0)
			this.subtypeUi(receiver, fty.domain[0])
		}

		//todo evar
		if (fty.tag !== "arrow") error()

		for (let par of view(fty.domain, isMethod?1:0)) {
			// substitute each parameter since context grows in information as we check arguments
			par = this.substitute(par)
			let ins = this.nextIns()
			assertL(ins.tag !== InstrTag.endapp, () => "expected argument of type " +
				showType(par))
			this.check(par)
		}

		assertEq(this.stepIns().tag, InstrTag.endapp) // invariant
		return this.substitute(fty.codomain)
	}
	// Types
	case InstrTag.any:
	case InstrTag.arrow:
		return useType
	case InstrTag.lam: {
		let ps = ins.ps
		let newTy: Type = {
			tag:"arrow",
			domain:ps.map(_=>mkEUse(this.allocEVar("H"))),
			codomain:mkEUse(this.allocEVar("CH"))
		}
		this.lambdaCheckOrInfer(newTy, ps)
		return newTy
	}
	case InstrTag.endapp:
	case InstrTag.endarrow:
	case InstrTag.endarray:
		unexpectedMatch(ins); break
	default:
		nonExhaustiveMatch(ins satisfies never)
	}
}

private infer() {
	try {
		let pretty = showExpr(this.arena(), this.k)
		this.enterTyping(`|- ${pretty} => ?`)
		let ty = this.infer_()
		this.exitTyping(`-| ${pretty} => ${showType(ty)}`)
		return ty
	} catch (e) {
		if (e instanceof CompileError) throw e
		throw new CompileError(this.ins().span, this.log.join("\n"), undefined, { cause: e })
	}
}

private switchCheckToInfer(ty: Type) {
	let ty2 = this.infer()
	this.subtypeUi(this.substitute(ty2),
		this.substitute(ty))
}

private check(ty: Type) {
	try {
	let ins = this.nextIns()
	switch (ins.tag) {
	case InstrTag.native:
		this.k++
		return
	case InstrTag.strlit:
	case InstrTag.int:
	case InstrTag.array:
	case InstrTag.use:
	case InstrTag.app:
	// Types
	case InstrTag.any:
	case InstrTag.arrow:
		this.switchCheckToInfer(ty)
		return
	case InstrTag.lam: {
		if (ty.tag === "euse") {
			// checking against unknown, switch to inference
			this.switchCheckToInfer(ty)
			return
		}
		this.k++
		this.lambdaCheckOrInfer(ty, ins.ps)
		return
	}
	case InstrTag.endapp:
	case InstrTag.endarrow:
	case InstrTag.endarray:
		unexpectedMatch(ins)
		break
	default:
		nonExhaustiveMatch(ins satisfies never)
	}
	} catch (e) {
		if (e instanceof CompileError) throw e
		throw new CompileError(this.ins().span, this.log.join("\n"), undefined, { cause: e })
	}
}

// false when typechecking expectedly @Fails
// true when typechecking succeeds
// exception upon type error and no @Fails annotations are present
private tyck_(resolve: (_: boolean) => void): boolean {
	try {
	let item = this.item
	switch (item.tag) {
	case ToplevelTag.cls: {
		let symbol = first(this.itemCtx.getToplevelSymbols())
		// add type constructor to globals
		mapInsert(this.root.globals, symbol, {
			gs: item.gs,
			ty: item.gs.length===0
			? useType
			: {tag:"arrow", domain:item.gs.map(_=>useType), codomain:useType},
			// todo: use codegen to get the value.. except types are not present
			// at runtime and are thus not codegened (?)
			value: new LateInit(item.gs.length===0
			? {tag:"cons", fullName:symbol, args:[]}
			: function*(...xs: any[]){
				return {tag:"cons", fullName:symbol, args:xs}
			})
		})

		// add generics to ctx
		for (let name of item.gs)
			this.ctx.push({tag: "uni", name})

		let normalConss: any = item.conss.map(c=>({
			...c, fields:c.fields.map(f=>
				this.normalize(f.type)
			)
		}))

		let self: Type = {tag: "cons",
			fullName:symbol,
			args:item.gs.map(mkUse)
		}
		for (let c of normalConss)
			mapInsert(this.root.globals, symbol+"ᐅ"+c.name, {
				gs: item.gs,
				ty: {tag: "arrow", domain: c.fields, codomain: self},

				// avoid codegen for constructors
				value: new LateInit(function*(...args: any[]) {
					let entries = args.map((arg,i)=>["_"+i,arg])
					entries.push(["tag", Symbol.for(c.name)])
					return Object.fromEntries(entries)
				})
			})
		let ret = Huk.invent("R", item.gs)
		let domain = [self].concat(normalConss.map((c: Constructor)=>({tag: "arrow",
			domain: c.fields,
			codomain: mkUse(ret)
		})
		))
		mapInsert(this.root.globals, symbol+"ᐅelim", {
			gs: item.gs.concat([ret]),
			ty: {tag: "arrow", domain, codomain: mkUse(ret)},
			value: new LateInit()
		})
		break
	}
	case ToplevelTag._let: {
		let symbol = this.itemCtx.getToplevelSymbol()
		let ty = this.normalize(item.retT)
		this.check(ty)
		mapInsert(this.root.globals, symbol, {
			gs: [],
			ty,
			value: new LateInit()
		})
		break
	}
	case ToplevelTag.fun: {
		assert(item.annots.length <= 1)

		// normalize the function type
		let normalParams = []
		for (let name of item.gs)
			this.ctx.push({tag: "uni", name})
		for (let {name, type} of item.bs) {
			let ty = this.normalize(type)
			normalParams.push(ty)
			this.ctx.push({tag: "var", name, ty})
		}
		let domain = normalParams
		let codomain = this.normalize(item.retT)

		let symbol = this.itemCtx.getToplevelSymbol()

		mapInsert(this.root.globals, symbol, {
			gs: item.gs,
			ty: {tag: "arrow", domain, codomain},
			value: new LateInit()
		})
		// Resolve early to allow recursive functions to tyck
		resolve(true)

		if (item.annots.length === 0)
			this.check(codomain)
		else {
			let expected = item.annots[0].text
			assertEq(item.annots[0].name, "Fails")
			try {
				this.check(codomain)
				error("expected error: "+expected)
			} catch (e) {
				if (!(e instanceof Error)) error("expected an `Error` instance")
				// If none of error messages match expectation, report discrepancy
				// and rethrow
				if (every(exceptionCauses(e), e => e.message !== expected)) {
					write(`Expected error "${expected}"`)
					throw e
				}

				mapRemove(this.root.globals, symbol)
				return false
			}
		}
		break
	}

	// When checking a type annotation
	case ToplevelTag.typeexpr:
		this.check(useType)
		break
	case ToplevelTag.infixdecl:
		break
	default:
		nonExhaustiveMatch(item satisfies never)
	}
	return true
	} catch (e) {
		if (e instanceof CompileError) throw e
		throw new CompileError(this.item.span, this.log.join("\n"), undefined, { cause: e })
	}
}

tyck(): boolean {
	return this.itemCtx.network.memoizeWithResolver("tyck-item", [],
		this.tyck_.bind(this))
}
}

export class RootTyck {
	// A fixture is a value or a function present at compilation time. C++ calls this constexpr and in Zig it's comptime
	// types and fixture values of global declarations
	globals: ObjectMap<{gs: string[], ty: Type, value: LateInit<any>}> =
		Object.create(null)
	fixtures: ObjectMap<any> = mapFilterMapProjection(this.globals,
		(_symbol, entry) => {
			if (entry.value === null || !entry.value.isSet()) return null
			return entry.value.get()
		})
	normalCounter: number = 0
}