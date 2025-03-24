import { error, assert, assertL, assertEq, nonExhaustiveMatch, mapInsert, nextLast, findUniqueIndex, map, filter, join, GeneratorFunction, ObjectMap, mapGet, LateInit, range, prettyPrint, mapRemove, mapFilterMapProjection, first } from './util.ts'

import { Syntax } from "./syntax.ts"
import { CompileError, Compiler, ItemCtx } from './compile.ts'

function showType(ty: any) {
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

const useType = {tag: "cons", fullName: "Type", args: []}

function mkUse(name: string) {
	return {tag:"use",name}
}

function mkEUse(name: string) {
	return {tag:"euse",name}
}

// The item typechecker, named after Yenisei
export class Huk {
private k: number = 0
private ctx: any[] = []

// log of typing judgements applied
private depth: number = 0
private log: string[] = []

// Codegen will be querying the methodname
private methodSymbolAt: ObjectMap<string> = Object.create(null)

constructor(
	private itemCtx: ItemCtx,
	private root: RootTyck, // toplevel tycker
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

// invent a name like hint but not present in "taken"
private static invent(hint: string, taken: string[]) {
	while (taken.includes(hint)) {
		let [_, alpha, num] =
			hint.match(/(\D*)(\d*)/)
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

// jit compile and close the code with a _fixtures_ object
private jitCompile(code: string): Function {
	try {
	code = `"use strict";\nreturn ` + code
	return new Function("_fixtures_", code)(this.root.fixtures)
	} catch (e) {
		throw new CompileError(this.item.span, "Obj:"+code, undefined, { cause: e })
	}
}

// normalization by jit compilation
private normalize(tyExpr: {tag: symbol, span: number, arena: any[]}) {
	try {
	assertEq(tyExpr.tag, Syntax.nakedfun)

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
		this.root, null, Compiler.makeItemNetwork(), tyExpr)

	//kinda hacky idk
	nakedCtx.tyck.ctx = [...this.ctx]
	nakedCtx.tyck.tyck()
	let cgs = nakedCtx.cg.codegen()
	assertEq(Object.keys(cgs), ["_"])
	let obj = `"use strict";\n` + cgs._

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
		if (e.constructor === CompileError) throw e
		throw new CompileError(tyExpr.span, undefined, undefined, { cause: e })
	}
}

private getTakenEVarNames(): string[] {
	return [...map(filter(this.ctx, x=>
		x.tag === "evar" || x.tag === "esolve"),
		x=>x.name)]
}

private allocEVar_(hint: string, taken: string[]) {
	let name = Huk.invent(hint, taken)
	this.ctx.push({tag:"evar", name})
	return name
}

private allocEVarMut(hint: string, taken: string[]) {
	let name = this.allocEVar_(hint, taken)
	taken.push(name)
	return name
}

private allocEVar(hint: string) {
	return this.allocEVar_(hint, this.getTakenEVarNames())
}

// Replace universal variables with existentials
private instantiate(vars: string[], ty: any) {
	this.enterTyping(`|- inst(${prettyPrint(vars)}, ${showType(ty)})`)

	// generate fresh evar names
	let mapp = Object.create(null)
	let taken = this.getTakenEVarNames()
	for (let uniName of vars)
		mapp[uniName] = this.allocEVarMut(uniName, taken)

	let ty1 = Huk.instantiate0(mapp, ty)
	this.exitTyping(`-| inst(${prettyPrint(vars)}, ${showType(ty)}) -> ${showType(ty1)}`)
	return ty1
}

private static instantiate0(varMap: ObjectMap<string>, ty: any) {
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
		nonExhaustiveMatch(ty.tag)
	}
}

// bidir.pdf: [Г]A
private substitute(ty: any) {
	//this.addTyping(`[${this.showCtx()}]${showType(ty)}`)
	switch (ty.tag) {
	case "any":
	case "use":
		return ty
	case "euse": {
		let ix = findUniqueIndex(this.ctx, x=>
			x.tag === "esolve" && x.name === ty.name)

		// evar not solved, but is it even declared?
		if (ix === -1)
			ix = findUniqueIndex(this.ctx, x=>
				x.tag === "evar" && x.name === ty.name)
		assert(ix !== -1, "evar not found") // invariant
		return this.ctx[ix].solution !== undefined ? this.ctx[ix].solution :
			ty
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
		nonExhaustiveMatch(ty.tag)
	}
}

private solveEvarTo(name: string, solution: any) {
	this.addTyping(`|- ?${name} <:= ${showType(solution)}`)
	assert(!this.ctx.some(
		x => x.tag === "esolve" && x.name === name),
		"evar already solved") // invariant

	let ix = findUniqueIndex(this.ctx,
		x => x.tag === "evar" && x.name === name)
	assert(ix !== -1) // invariant
	this.ctx[ix] = {...this.ctx[ix], tag: "esolve", solution}
	//todo: occurs check
}

private unify_(ty1: any, ty2: any) {
	if (ty1.tag === "euse" &&
		ty2.tag === "euse" &&
		ty1.name === ty2.name)
		return
	if (ty1.tag === "euse") {
		this.solveEvarTo(ty1.name, ty2)
		return
	}
	if (ty2.tag === "euse") {
		this.solveEvarTo(ty2.name, ty1)
		return
	}
	if (ty1.tag === "any" || ty2.tag === "any")
		return

	switch (ty1.tag) {
	case "use":
		assert(ty2.tag === "use" && ty1.name === ty2.name)
		break
	case "cons":
		assertEq(ty2.tag, "cons")
		assertEq(ty1.fullName, ty2.fullName)
		for (let i of range(assertEq(ty1.args.length, ty2.args.length))) {
			this.unify(ty1.args[i], ty2.args[i])
			ty1 = this.substitute(ty1)
			ty2 = this.substitute(ty2)
		}
		break
	case "arrow":
		assert(ty2.tag === "arrow")
		assert(ty1.domain.length === ty2.domain.length)
		for (let i of range(ty1.domain.length)) {
			this.unify(ty1.domain[i], ty2.domain[i])
			ty1 = this.substitute(ty1)
			ty2 = this.substitute(ty2)
		}
		this.unify(ty1.codomain, ty2.codomain)
		break
	default:
		nonExhaustiveMatch(ty1.tag)
	}
}

private unify(ty1: any, ty2: any) {
	this.enterTyping(`|- ${showType(ty1)} <: ${showType(ty2)}`)
	this.unify_(ty1, ty2)
	this.exitTyping(`-| ${showType(ty1)} <: ${showType(ty2)}`)
}

private unifyUi(ty1: any, ty2: any) {
	try {
		this.unify(ty1, ty2)
	} catch (e) {
		assert(e.constructor !== CompileError)
		e.message = `error: \`${showType(ty1)}' is not a subtype of \`${showType(ty2)}'`
		throw new CompileError(this.ins().span, this.log.join("\n"),
			undefined,
			{ cause: e })
	}
}

private infer_() {
	let insLocation = this.k
	let ins = this.stepIns()
	switch (ins.tag) {
	case Syntax.strlit:
		return {tag:"cons", fullName:"String", args:[]}
	case Syntax.native:
		return {tag: "any"}
	case Syntax.int:
		return {tag:"cons", fullName:"Int", args:[]}
	case Syntax.use: {
		// try finding a uni
		if (this.ctx.findLastIndex(x=>
			x.tag === "uni" && x.name === ins.name) !== -1)
			return useType
		// try finding a local
		let ix = this.ctx.findLastIndex(x=>
			x.tag === "var" && x.name === ins.name)
		if (ix !== -1)
			return this.ctx[ix].ty

		// try finding a global
		let gb = this.root.globals[ins.name]
		if (gb === undefined) error("var not found")
		return this.instantiate(gb.gs, gb.ty)
	}
	case Syntax.array: {
		// if array is empty, element type is a fresh evar, otherwise infer
		let elementTy = this.nextIns().tag===Syntax.endarray ?
			mkEUse(this.allocEVar("Arr")) :
			this.infer()

		while (this.nextIns().tag!==Syntax.endarray)
			this.check(elementTy)
		this.k++

		return {tag:"cons", fullName:"Array", args:[elementTy]}
	}
	case Syntax.app: {
		let isMethod = ins.metName !== null
		let fty
		if (!isMethod)
			fty = this.infer()
		else {
			let receiver = this.infer()
			assertEq(receiver.tag, "cons")

			let methodSymbol = receiver.fullName+"ᐅ"+ins.metName
			mapInsert(this.methodSymbolAt, insLocation, methodSymbol)
			let gb = this.root.globals[methodSymbol]

			assert(gb !== undefined,
				"method not found")
			fty = this.instantiate(gb.gs, gb.ty)
			assert(fty.domain.length > 0)
			this.unifyUi(receiver, fty.domain[0])
		}

		assertEq(fty.tag, "arrow") //todo evar

		for (let i of range(isMethod?1:0, fty.domain.length)) {
			// mutate the type as we iterate through it, yuppie!!!
			// this is necessary since context grows in information as we check arguments
			// todo: performance: only substitute remaining arguments
			fty = this.substitute(fty)

			let par = fty.domain[i]
			let ins = this.nextIns()
			assertL(ins.tag !== Syntax.endapp, () => "expected argument of type " +
				showType(par))
			// simple application
			if (ins.tag !== Syntax.applam) {
				this.check(par)
				continue
			}

			// application of trailing lambda
			this.k++
			if (par.tag !== "euse") {
				assertEq(par.tag, "arrow")
				assertEq(par.domain.length, ins.ps.length)
			} else {
				let newPar = {
					tag:"arrow",
					domain:ins.ps.map(_=>mkEUse(this.allocEVar("H"))),
					codomain:mkEUse(this.allocEVar("CH"))
				}
				this.solveEvarTo(par.name, newPar)
				par = newPar
			}
			let ps = ins.ps
			for (let j of range(par.domain.length)) {
				this.ctx.push({
					tag: "var",
					name: ps[j],
					ty: par.domain[j]
				})
			}
			this.check(par.codomain)
			for (let name of ps) {
				let ix = this.ctx.findLastIndex(x =>
					x.tag === "var" &&
					x.name === name)
				assert(ix >= 0) // invariant
				this.ctx.splice(ix, 1)
			}
		}

		assertEq(this.stepIns().tag, Syntax.endapp) // invariant
		return this.substitute(fty.codomain)
	}
	// Types
	case Syntax.any:
	case Syntax.arrow:
		return useType
	default:
		nonExhaustiveMatch(ins.tag)
	}
}

private infer() {
	try {
		this.enterTyping(`|- _ => ?`)
		let ty = this.infer_()
		this.exitTyping(`-| _ => ${showType(ty)}`)
		return ty
	} catch (e) {
		if (e.constructor === CompileError) throw e
		throw new CompileError(this.ins().span, this.log.join("\n"), undefined, { cause: e })
	}
}

private check(ty: any) {
	try {
	let ins = this.stepIns()
	switch (ins.tag) {
	case Syntax.native:
		return
	case Syntax.strlit:
	case Syntax.int:
	case Syntax.array:
	case Syntax.use:
	case Syntax.app:
	// Types
	case Syntax.any:
	case Syntax.arrow: {
		this.k--
		let ty2 = this.infer()
		this.unifyUi(this.substitute(ty2),
			this.substitute(ty))
		return
	}
	default:
		nonExhaustiveMatch(ins.tag)
	}
	} catch (e) {
		if (e.constructor === CompileError) throw e
		throw new CompileError(this.ins().span, this.log.join("\n"), undefined, { cause: e })
	}
}

// false when typechecking expectedly @Fails
// true when typechecking succeeds
// exception upon type error and no @Fails annotations are present
private tyck_(): boolean {
	try {
	let item = this.item
	switch (item.tag) {
	case Syntax.cls: {
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
			: function*(...xs){
				return {tag:"cons", fullName:symbol, args:xs}
			})
		})

		// add generics to ctx
		for (let name of item.gs)
			this.ctx.push({tag: "uni", name})

		let normalConss = item.conss.map(c=>({
			...c, fields:c.fields.map(f=>
				this.normalize(f.type)
			)
		}))

		let self = {tag: "cons",
			fullName:symbol,
			args:item.gs.map(mkUse)
		}
		for (let c of normalConss)
			mapInsert(this.root.globals, symbol+"ᐅ"+c.name, {
				gs: item.gs,
				ty: {tag: "arrow", domain: c.fields, codomain: self},

				// avoid codegen for constructors
				value: new LateInit(function*(...args) {
					let entries = args.map((arg,i)=>["_"+i,arg])
					entries.push(["tag", Symbol.for(c.name)])
					return Object.fromEntries(entries)
				})
			})
		let ret = Huk.invent("R", item.gs)
		let domain = [self].concat(normalConss.map(c=>({tag: "arrow",
			domain: c.fields,
			codomain: mkUse(ret)
		})
		))
		mapInsert(this.root.globals, symbol+"ᐅelim", {
			gs: item.gs.concat([ret]),
			ty: {tag: "arrow", domain: domain, codomain: mkUse(ret)},
			value: new LateInit()
		})
		break
	}
	case Syntax.let: {
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
	case Syntax.fun: {
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

		if (item.annots.length === 0)
			this.check(codomain)
		else {
			let expected = item.annots[0].text
			assertEq(item.annots[0].name, "Fails")
			try {
				this.check(codomain)
				error("expected error: "+expected)
			} catch (e) {
				while (e.cause !== undefined) e = e.cause
				assertEq(e.message, expected)

				mapRemove(this.root.globals, symbol)
				return false
			}
		}
		break
	}

	// When checking a type annotation
	case Syntax.nakedfun:
		this.check(useType)
		break
	default:
		nonExhaustiveMatch(item.tag)
	}
	return true
	} catch (e) {
		if (e.constructor === CompileError) throw e
		throw new CompileError(this.item.span, this.log.join("\n"), undefined, { cause: e })
	}
}

tyck(): boolean {
	return this.itemCtx.network.memoize("tyck-item", [],
		this.tyck_.bind(this))
}

addFixtures() {
	let cgs = this.itemCtx.cg.codegen()

	for (let cgSymbol in cgs)
		mapGet(this.root.globals, cgSymbol).value.setIfUnsetThen(
			()=>this.jitCompile(cgs[cgSymbol])
		)
}
}

export class RootTyck {
	// A fixture is a value or a function present at compilation time. C++ calls this constexpr and in Zig it's comptime
	// types and fixture values of global declarations
	globals: ObjectMap<{gs: string[], ty: any, value: LateInit<any>}> =
		Object.create(null)
	fixtures: ObjectMap<any> = mapFilterMapProjection(this.globals,
		(_symbol, entry) => {
			if (entry.value === null) return null
			return entry.value.get()
		})
	normalCounter: number = 0
}