import { error, assert, assertL, assertEq, nonExhaustiveMatch, mapInsert, nextLast, findUniqueIndex, map, filter, join, GeneratorFunction, ObjectMap, mapMap, mapGet, LateInit, range } from './util.ts'

import { Syntax } from "./syntax.ts"
import { Compiler } from './compile.ts'
import { mangle } from './codegen.ts'

function typeToString(ty: any) {
  if (ty===undefined||ty===null) return String(ty)
  switch (ty.tag) {
    case "any":
      return "any"
    case "use":
      return ty.name
    case "euse":
      return "?" + ty.name
    case "cons":
      return `${ty.name}(${join(map(ty.args, typeToString), " ")})`
    case "arrow":
      return `[${join(map(ty.domain, typeToString), " ")}]` + typeToString(ty.codomain)
    default:
      nonExhaustiveMatch(ty.tag)
  }
}

const useType = {tag: "cons", name: "Type", args: []}

function mkUse(name: string) {
  return {tag:"use",name}
}

function mkType(o: any) {
  Object.setPrototypeOf(o, {
    toString() {
      return typeToString(this)
    }
  })
  return o
}

// The item typechecker, named after Yenisei
export class Huk {
  c: Compiler
  root: RootTyck
  item: any
  k: number
  ctx: any[]
  methodNameAt: ObjectMap<string>
  funName: string

  constructor(root: RootTyck, item: any) {
    this.c = root.c // compiler
    this.root = root // toplevel tycker

    // item-local state
    this.item = item
    this.k = 0
    this.ctx = []

    // Codegen will be querying the methodname
    // Map<int, string>
    this.methodNameAt = Object.create(null)
    this.funName = null
  }

nextIns() {
  return this.item.arena[this.k]
}

stepIns() {
  return this.item.arena[this.k++]
}

// invent a name like hint but not present in "taken"
static invent(hint: string, taken: string[]) {
  while (taken.includes(hint)) {
    let [_, alpha, num] =
      hint.match(/(\D*)(\d*)/)
    hint = alpha+(parseInt(num,10)+1)
  }
  return hint
}

getFunName() {
  return this.c.itemNetwork.memoize("fun-name", [], () => this.funName)
}

getMethodNameAt(insLocation: number) {
  return this.c.itemNetwork.memoize("method-name-at", [insLocation.toString()],
    (insLocation) => {
    return mapGet(this.methodNameAt, insLocation)
  })
}

// normalization by jit compilation
normalize(tyExpr: any) {
  //this.c.log("normalize", tyExpr)
  this.root.normalCounter++
  // prepare environment (it will be passed in params)
  let fixtures = mapMap(this.root.globals,
    ({value})=>value===null?null:value.get())
  let env = Object.create(null)
  env.__fixtures__ = fixtures
  for (let x of this.ctx) {
    if (x.tag === "uni")
      env[x.name] = {tag:"use",name:x.name}
  }
  let envv = Object.entries(env)
  let paramNames = envv.map(x=>x[0])
  let args = envv.map(x=>x[1])
  
  let obj = `"use strict";\n` +
    this.c.cg.getItemCodegen(tyExpr, fixtures).codegen_()
  
  //this.c.log("env:", env)
  //this.c.log(`obj: function*(${join(paramNames)}) {\n${obj}\n}`)
  let g = new GeneratorFunction(...paramNames, obj)(...args)
  let normalized = nextLast(g)
  //this.c.log("normalized:", normalized)
  return normalized
}

getTakenEVarNames(): string[] {
  return [...map(filter(this.ctx, x=>
    x.tag === "evar" || x.tag === "esolve"),
    x=>x.name)]
}

allocEVar_(hint: string, taken: string[]) {
  let name = Huk.invent(hint, taken)
  this.ctx.push({tag:"evar", name})
  return name
}

allocEVarMut(hint: string, taken: string[]) {
  let name = this.allocEVar_(hint, taken)
  taken.push(name)
  return name
}

allocEVar(hint: string) {
  return this.allocEVar_(hint, this.getTakenEVarNames())
}

// Replace universal variables with existentials
instantiate(vars: string[], ty: any) {
  //this.c.log("inst", ty)
  // generate fresh evar names
  let mapp = Object.create(null)
  let taken = this.getTakenEVarNames()
  for (let uniName of vars)
    mapp[uniName] = this.allocEVarMut(uniName, taken)
  return Huk.instantiate0(mapp, ty)
}

static instantiate0(varMap: ObjectMap<string>, ty: any) {
  //this.c.log("instantiate0", varMap, ty)
  switch (ty.tag) {
  case "cons":
    return {tag: "cons",
      name: ty.name,
      args: ty.args.map(this.instantiate0.bind(this, varMap))
    }
  case "arrow":
    return {tag: "arrow",
      domain: ty.domain.map(this.instantiate0.bind(this, varMap)),
      codomain: this.instantiate0(varMap, ty.codomain)
    }
  case "use":
    let name = varMap[ty.name]
    if (name === undefined) return ty
    return {tag: "euse", name}
  case "any":
  case "euse":
    return ty
  default:
    nonExhaustiveMatch(ty.tag)
  }
}
  
// bidir.pdf: [Г]A
substitute(ty: any) {
  //this.c.log(typeToString(ty))
  switch (ty.tag) {
  case "any":
  case "use":
    return ty
  case "euse":
    let ix = findUniqueIndex(this.ctx, x=>
      x.tag === "esolve" && x.name === ty.name)
    
    // evar not solved, but is it even declared? 
    if (ix === -1)
      ix = findUniqueIndex(this.ctx, x=>
        x.tag === "evar" && x.name === ty.name)
    assertL(ix !== -1, () => "evar not found" + this.c.errorAt(this.nextIns().span)) // invariant
    return this.ctx[ix].solution !== undefined ? this.ctx[ix].solution :
      ty
  case "cons":
    return {tag: "cons",
      name: ty.name, 
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

solveEvarTo(name: string, solution: any) {
  //this.c.log("solve evar", name, solution)
  assert(!this.ctx.some(
    x => x.tag === "esolve" && x.name === name),
    "evar already solved") // invariant

  let ix = findUniqueIndex(this.ctx,
    x => x.tag === "evar" && x.name === name)
  assert(ix !== -1) // invariant
  this.ctx[ix] = {...this.ctx[ix], tag: "esolve", solution}
  //todo: occurs check
}

unify(ty1: any, ty2: any) {
  /*write("unify", typeToString(ty1),
    typeToString(ty2), this.ctx)*/
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
      assert(ty2.tag === "use" && ty1.name === ty2.name,
        `error: "${typeToString(ty1)}" is not a subtype of "${typeToString(ty2)}"` +
        this.c.errorAt(0))
      break
    case "cons":
      assertEq(ty2.tag, "cons")
      assertEq(ty1.name, ty2.name)
      assertEq(ty1.args.length, ty2.args.length)
      for (let i of range(ty1.args.length)) {
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
  
infer() {
  let insLocation = this.k
  let ins = this.stepIns()
  //this.c.log("infer", ins, this.ctx)
  switch (ins.tag) {
  case Syntax.strlit:
    return {tag:"cons", name:"String", args:[]}
  case Syntax.native:
    return {tag: "any"}
  case Syntax.int:
    return {tag:"cons", name:"Int", args:[]}
  case Syntax.use:
    // try finding a local
    let ix = this.ctx.findLastIndex(x=>
      x.tag === "var" && x.name === ins.name)
    if (ix !== -1)
      return this.ctx[ix].ty
    
    // try finding a global
    let gb = this.root.globals[ins.name]
    if (gb === undefined) error("var not found" + this.c.errorAt(ins.span))
    return this.instantiate(gb.gs, gb.ty)
  case Syntax.array:
    // if array is empty, element type is a fresh evar, otherwise infer
    let elementTy = this.nextIns().tag===Syntax.endarray ?
      {tag:"euse", name:this.allocEVar("Arr")} :
      this.infer()

    while (this.nextIns().tag!==Syntax.endarray)
      this.check(elementTy)
    this.k++

    return {tag:"cons", name:"Array", args:[elementTy]}
  case Syntax.app:
    let isMethod = ins.metName !== null
    let fty
    if (!isMethod)
      fty = this.infer()
    else {
      let receiver = this.infer()
      assertEq(receiver.tag, "cons")
      
      let methodName = receiver.name+"/"+ins.metName
      mapInsert(this.methodNameAt, insLocation, methodName)
      let gb = this.root.globals[methodName]
      
      assert(gb !== undefined,
        "method not found" + this.c.errorAt(ins.span))
      fty = this.instantiate(gb.gs, gb.ty)
      assert(fty.domain.length > 0)
      this.unify(receiver, fty.domain[0])
    }
    //this.c.log("fty", typeToString(fty))
    assertEq(fty.tag, "arrow") //todo evar
    
    for (let i of range(isMethod?1:0, fty.domain.length)) {
      // mutate the type as we iterate through it, yuppie!!! 
      // this is necessary since context grows in information as we check arguments
      // todo: performance: only substitute remaining arguments
      fty = this.substitute(fty)
      //this.c.log("new fty", typeToString(fty), this.ctx)
      
      let par = fty.domain[i]
      let ins = this.nextIns()
      assertL(ins.tag !== Syntax.endapp, () => "expected argument of type " +
        typeToString(par) +
        this.c.errorAt(ins.span))
      // simple application
      if (ins.tag !== Syntax.applam) {
        this.check(par)
        continue
      }
      this.k++
      // application of trailing lambda
      assertEq(par.tag, "arrow")
      assertEq(par.domain.length, ins.ps.length)
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
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
check(ty: any) {
  let ins = this.stepIns()
  //this.c.log("check", ins, typeToString(ty))
  switch (ins.tag) {
  case Syntax.native:
    return
  case Syntax.strlit:
  case Syntax.int:
  case Syntax.array:
  case Syntax.use:
  case Syntax.app:
    this.k--
    let ty2 = this.infer()
    //this.c.log("inferred for check", ty2)
    this.unify(this.substitute(ty2),
      this.substitute(ty))
    return
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
tyck() {
  let item = this.item
  switch (item.tag) {
  case Syntax.cls: {
    // add type constructor to globals
    mapInsert(this.root.globals, item.name, {
      gs: item.gs,
      ty: item.gs.length===0
      ? useType
      : {tag:"arrow", domain:item.gs.map(_=>useType), codomain:useType},
      // todo: use codegen to get the value.. except types are not present
      // at runtime and are thus not codegened (?)
      value: new LateInit(item.gs.length===0
      ? {tag:"cons", name:item.name, args:[]}
      : function*(...xs){
        return {tag:"cons", name:item.name, args:xs}
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
      name:item.name,
      args:item.gs.map(mkUse)
    }
    for (let c of normalConss) {
      mapInsert(this.root.globals, item.name+"/"+c.name, {
        gs: item.gs,
        ty: {tag: "arrow", domain: c.fields, codomain: self},
        value: null // todo
      })
    }
    let ret = Huk.invent("R", item.gs)
    let domain = [self].concat(normalConss.map(c=>({tag: "arrow",
      domain: c.fields,
      codomain: mkUse(ret)
    })
    ))
    mapInsert(this.root.globals, item.name+"/elim", {
      gs: item.gs.concat([ret]),
      ty: {tag: "arrow", domain: domain, codomain: mkUse(ret)},
      value: null // todo
    })
    break
  }
  case Syntax.let:
    let ty = this.normalize(item.retT)
    this.check(ty)
    mapInsert(this.root.globals, item.name, {
      gs: [],
      ty,
      value: null // todo
    })
    break
  case Syntax.fun:
    //let beforeFun = performance.now()
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

    let name
    if (item.isMethod) {
      assert(item.bs.length >= 1)
      assertEq(domain[0].tag, "cons")
      name = domain[0].name + "/" + item.name
    } else name = item.name
    this.funName = name

    mapInsert(this.root.globals, name, {
      gs: item.gs,
      ty: {tag: "arrow", domain, codomain},
      value: new LateInit()
    })

    if (item.annots.length === 0)
      this.check(codomain)
    else {
      let expected = item.annots[0].text
      try {
        this.check(codomain)
        error("expected error: "+expected)
      } catch (e) {
        assertEq(e.message, expected)
      }
    }

    // fill-in the fixture
    mapGet(this.root.globals, name).value.set(
      eval?.(this.c.itemCg.codegen() + mangle(name))
    )

    // check if all evars are solved? no
    //assert(this.ctx.)
    //if (this.c.logging) write(`fun ${name} analysis time`, performance.now()-beforeFun)
    break
  case Syntax.eof:
    break
  default:
    nonExhaustiveMatch(item.tag)
  }
}
}

export class RootTyck {
  c: any
  globals: ObjectMap<{gs: string[], ty: any, value: LateInit<any>}>
  normalCounter: number

  constructor(c: any) {
    this.c = c // compiler
    // A fixture is a value or a function present at compilation time. C++ calls this constexpr and in Zig it's comptime
    // types and fixture values of global declarations
    // Map<string, {ty, value}>
    this.globals = Object.create(null)
    this.normalCounter = 0
  }
  
  getItemTyck(item: any) {
    return new Huk(this, item)
  }

  /*
  initializeDucts(network: Network) {
    network.register("method-name-at", (insLocation) => {
      return mapGet(this.c.itemTyck.methodNameAt, insLocation)
    })
  }
  */
}