import { toString, dbg, error, assert, assertL, assertEq, write, fuel, nonExhaustiveMatch, mapInsert, step, nextLast, it, findUniqueIndex, map, filter, join } from './util.js';

import { Syntax } from "./syntax.js"

function typeToString(ty) {
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

function mkUse(name) {
  return {tag:"use",name}
}

function mkType(o) {
  Object.setPrototypeOf(o, {
    toString() {
      return typeToString(this)
    }
  })
  return o
}

// The typechecker, named after Yenisei
export class Huk {
  constructor(c, ch) {
    this.c = c // compiler
    // Map<string, type>
    this.globals = Object.create(null)
    
    this.item = null
    this.k = -13
    this.ctx = null

    // Codegen will be querying the methodname
    // Map<int, string>
    this.methodNameAt = null
  }

setItem(item) {
  this.item = item
  this.k = 0
  this.ctx = []
  
  this.methodNameAt = Object.create(null)
}

nextIns() {
  return this.item.arena[this.k++]
}

// invent a name like hint but not present in "taken"
static invent(hint, taken) {
  let name = hint
  while (taken.includes(name))
    name += "0"
  return name
}

// Replace universal variables with existentials
instantiate(vars, ty) {
  write("inst", ty)
  // generate fresh evar names
  let mapp = Object.create(null)
  for (let uniName of vars) {
    let taken = [...map(filter(this.ctx, x=>
      x.tag === "evar" || x.tag === "esolve"),
      x=>x.name)]
    let name = Huk.invent(uniName, taken)
    mapp[uniName] = name
    this.ctx.push({tag: "evar", name})
  }
  return Huk.instantiate0(mapp, ty)
}

static instantiate0(varMap, ty) {
  //write("instantiate0", varMap, ty)
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
substitute(ty) {
  switch (ty.tag) {
  case "any":
  case "use":
    return ty
  case "euse":
    let ix = findUniqueIndex(this.ctx, ({tag, name}) => tag === "esolve" && name === ty.name)
    
    // evar not solved, but is it even declared? 
    if (ix === -1)
      ix = findUniqueIndex(this.ctx, ({tag, name}) => tag === "evar" && name === ty.name)
    assertL(ix !== -1, () => "evar not found" + this.c.errorAt(ins.span)) // invariant
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

solveEvarTo(name, solution) {
  //write("solve evar", name, solution)
  assert(!this.ctx.some(
    x => x.tag === "esolve" && x.name === name),
    "evar already solved") // invariant

  let ix = findUniqueIndex(this.ctx,
    x => x.tag === "evar" && x.name === name)
  assert(ix !== -1) // invariant
  this.ctx[ix] = {...this.ctx[ix], tag: "esolve", solution}
  //todo: occurs check
}

unify(ty1, ty2) {
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
        this.c.errorAt())
      break
    case "cons":
      assertEq(ty2.tag, "cons")
      assertEq(ty1.name, ty2.name)
      assertEq(ty1.args.length, ty2.args.length)
      for (var i = 0; i < ty1.args.length; i++) {
        this.unify(ty1.args[i], ty2.args[i])
        ty1 = this.substitute(ty1)
        ty2 = this.substitute(ty2)
      }
      break
    case "arrow":
      assert(ty2.tag === "arrow")
      assert(ty1.domain.length === ty2.domain.length)
      for (var i = 0; i < ty1.domain.length; i++) {
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
  let ins = this.nextIns()
  //write("infer", ins, this.ctx)
  switch (ins.tag) {
  case Syntax.strlit:
    return mkUse("String")
  case Syntax.native:
    return {tag: "any"}
  case Syntax.use:
    // try finding a local
    let ix = this.ctx.findLastIndex(({tag, name}) => tag === "var" && name === ins.name)
    if (ix !== -1)
      return this.ctx[ix].type
    
    // try finding a global
    let gb = this.globals[ins.name]
    assert(gb !== undefined, "var not found" + this.c.errorAt(ins.span))
    return this.instantiate(gb.gs, gb.ty)
  case Syntax.app:
    let isMethod = ins.metName !== null
    //write("infer app")
    let fty
    if (!isMethod)
      fty = this.infer()
    else {
      let receiver = this.infer()
      assertEq(receiver.tag, "cons")
      
      let methodName = receiver.name+"/"+ins.metName
      mapInsert(this.methodNameAt, insLocation, methodName)
      let gb = this.globals[methodName]
      
      assert(gb !== undefined,
        "method not found" + this.c.errorAt(ins.span))
      fty = this.instantiate(gb.gs, gb.ty)
      assert(fty.domain.length > 0)
      this.unify(receiver, fty.domain[0])
    }
    write("fty", typeToString(fty))
    assertEq(fty.tag, "arrow") //todo evar
    
    for (let i = isMethod?1:0; i < fty.domain.length; i++) {
      // mutate the type as we iterate through it, yuppie!!! 
      // this is necessary since context grows in information as we check arguments
      // todo: performance: only substitute remaining arguments
      fty = this.substitute(fty)
      write("new fty", typeToString(fty), this.ctx)
      
      let par = fty.domain[i]
      let ins2 = this.nextIns()
      if (ins2.tag === Syntax.endapp)
        error("expected argument of type " +
        typeToString(par) +
        this.c.errorAt(ins2.span))
      // simple application
      if (ins2.tag !== Syntax.applam) {
        this.k--
        this.check(par)
        continue
      }
      // application of trailing lambda
      assertEq(par.tag, "arrow")
      assertEq(par.domain.length, ins2.ps.length)
      let ps = ins2.ps
      for (var j = 0; j < par.domain.length; j++) {
        this.ctx.push({
          tag: "var",
          name: ps[j],
          type: par.domain[j]
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

    assertEq((this.nextIns()).tag, Syntax.endapp) // invariant
    return this.substitute(fty.codomain)
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
check(ty) {
  let ins = this.nextIns()
  write("check", ins, ty)
  switch (ins.tag) {
  case Syntax.native:
    return
  case Syntax.strlit:
  case Syntax.use:
  case Syntax.app:
    this.k--
    let ty2 = this.infer()
    write("inferred for check", ty2)
    this.unify(this.substitute(ty2),
      this.substitute(ty))
    return
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
tyck() {
  // A container for functions and constants to be used during compile-time evaluation
  // It's an extension of global object so generated code can refer to js builtins too
  globalThis.fixtures = Object.create(globalThis)
  
  let item = this.item
  switch (item.tag) {
  case Syntax.cls:
    write(fixtures,item.name,fixtures[item.name])
    fixtures[item.name] = (...xs)=>({
      tag:"cons", name:item.name, args:xs})
    
    let self = {tag: "cons", 
          name:item.name,
          args:item.gs.map(mkUse)
        }
    for (let c of item.cons) {
      mapInsert(this.globals, item.name+"/"+c.name, {gs: item.gs, ty: {tag: "arrow", domain: c.fields.map(x=>x.type), codomain: self
      }})
    }
    let ret = Huk.invent("R", item.gs)
    let domain = [self].concat(item.cons.map(c=>({tag: "arrow",
      domain: c.fields.map(f=>f.type),
      codomain: mkUse(ret)
    })
    ))
    mapInsert(this.globals, item.name+"/elim", {gs: item.gs.concat([ret]), ty: {tag: "arrow", domain, codomain: mkUse(ret)}})
    break
  case Syntax.let:
    this.check(item.retT)
    this.ctx = []
    mapInsert(this.globals, item.name,
    {gs: [], ty: item.retT})
    break
  case Syntax.fun:
    let beforeFun = performance.now()
    assert(item.annots.length <= 1)
    let name = getFunName(item)
    write(name)
    mapInsert(this.globals, name,
    {gs: item.gs, ty: {tag: "arrow", domain: item.bs.map(x => x.type), codomain: item.retT}})
    for (let name of item.gs)
      this.ctx.push({tag: "uni", name})
    for (let {name, type} of item.bs)
      this.ctx.push({tag: "var", name, type})

    if (item.annots.length === 0)
      this.check(item.retT)
    else {
      try {
        this.check(item.retT)
        error("[no error]")
      } catch (e) {
        assertEq(e.message, item.annots[0].text)
      }
    }
    
    // check if all evars are solved? no
    //assert(this.ctx.)
    write(`fun ${name} analysis time`, performance.now()-beforeFun)
    break
  case Syntax.eof:
    break
  default:
    nonExhaustiveMatch(item.tag)
  }
}
}

export function getFunName(item) {
  if (item.isMethod) {
    assert(item.bs.length >= 1)
    assertEq(item.bs[0].type.tag, "cons")
    return item.bs[0].type.name + "/" + item.name
  } else return item.name
}

function normalize(inss) {
  // Tab to edit
}