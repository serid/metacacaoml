import { toString, dbg, error, assert, assertL, assertEq, write, fuel, nonExhaustiveMatch, step, nextLast, it, findUniqueIndex, map, join } from './util.js';

import { Syntax } from "./syntax.js"

function typeToString(ty) {
  switch (ty.tag) {
    case "any":
      return "any"
    case "use":
      return ty.name
    case "euse":
      return "?" + ty.name
    case "arrow":
      return `[${join(map(ty.domain, typeToString), " ")}]` + typeToString(ty.codomain)
    default:
      nonExhaustiveMatch(ty.tag)
  }
}

function mkType(o) {
  Object.setPrototypeOf(o, {
    toString() {
      return typeToString(this)
    }
  })
  return o
}

// The typechecker
export class Huk {
  constructor(c, ch) {
    this.c = c // compiler
    this.ch = ch
    this.globals = Object.create(null)
    this.ctx = []
  }
  
// static map(ty)

// Replace universal variables with existentials
instantiate(vars, ty) {
  // generate fresh evar names
  let map = Object.create(null)
  for (let uniName of vars) {
    let newName = uniName
    let predicate = x =>
      (x.tag === "evar" || x.tag === "esolve") && x.name === newName
    while (this.ctx.some(predicate))
      newName += "0"
    map[uniName] = newName
    this.ctx.push({tag: "evar", name: newName})
  }
  return Huk.instantiate0(map, ty)
}

static instantiate0(varMap, ty) {
  write("instantiate0", varMap, ty)
  switch (ty.tag) {
  case "arrow":
    return {tag: "arrow",
      domain: ty.domain.map(this.instantiate0.bind(this, varMap)),
      codomain: this.instantiate0(varMap, ty.codomain)
    }
  case "use":
    if (varMap[ty.name] === undefined) return ty
    return {...ty, tag: "euse"}
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
  write("solve evar", name, solution)
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
  write("unify", ty1, ty2, this.ctx) 
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
      assert(ty2.tag === "use")
      assert(ty1.name === ty2.name,
        `error: "${typeToString(ty1)}" is not a subtype of "${typeToString(ty2)}"` +
        this.c.errorAt())
      break
    case "arrow":
      assert(ty2.tag === "arrow")
      assert(ty1.domain.length === ty2.domain.length)
      for (var i = 0; i < ty1.domain.length; i++)
        this.unify(ty1.domain[i], ty2.domain[i])
      this.unify(ty1.codomain, ty2.codomain)
      break
    default:
      nonExhaustiveMatch(ty1.tag)
  }
}
  
async infer() {
  let ins = await this.ch.recv()
  write("infer", ins, this.ctx)
  switch (ins.tag) {
  case Syntax.strlit:
    return {tag: "use", name: "String"}
  case Syntax.native:
    return {tag: "any"}
  case Syntax.use:
    // try finding a local
    let ix = this.ctx.findLastIndex(({tag, name}) => tag === "var" && name === ins.name)
    if (ix !== -1)
      return this.ctx[ix].type
    
    // try finding a global
    let fun = this.globals[ins.name]
    if (fun !== undefined)
      return this.instantiate(fun.gs, {tag: "arrow", domain: fun.domain, codomain: fun.codomain}) 
    error("var not found" + this.c.errorAt(ins.span))
  case Syntax.app:
    write("infer app")
    let fty = await this.infer()
    write("fty", fty)
    assertEq(fty.tag, "arrow") //todo evar
    
    for (let i = 0; i < fty.domain.length; i++) {
      // mutate the type as we iterate through it, yuppie!!! 
      // this is necessary since context grows in information as we check arguments
      fty = this.substitute(fty)
      write("new fty", fty, this.ctx)
      
      let par = fty.domain[i]
      let ins2 = await this.ch.recv()
      if (ins2.tag === Syntax.endapp)
        error("expected argument of type " +
        typeToString(par) +
        this.c.errorAt(ins2.span))
      // simple application
      if (ins2.tag !== Syntax.applam) {
        this.ch.unshift(ins2)
        await this.check(par)
        continue
      }
      // application of trailing lambda
      assertEq(par.tag, "arrow")
      assert(par.domain.length === ins2.ps.length)
      let ps = ins2.ps
      for (var j = 0; j < par.domain.length; j++) {
        this.ctx.push({
          tag: "var",
          name: ps[j],
          type: par.domain[j]
        })
      }
      await this.check(par.codomain)
      for (let name of ps) {
        let ix = this.ctx.findLastIndex(x =>
          x.tag === "var" &&
          x.name === name)
        assert(ix >= 0) // invariant
        this.ctx.splice(ix, 1)
      }
    }
    
    assertEq((await this.ch.recv()).tag, Syntax.endapp) // invariant
    return this.substitute(fty.codomain)
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
async check(ty) {
  let ins = await this.ch.recv()
  write("check", ins, ty)
  switch (ins.tag) {
  case Syntax.native:
    return
  case Syntax.strlit:
  case Syntax.use:
  case Syntax.app:
    this.ch.unshift(ins)
    let ty2 = await this.infer()
    write("inferred for check", ty2)
    this.unify(this.substitute(ty2),
      this.substitute(ty))
    return
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
async tyck() {
  while (true) {
  let ins = await this.ch.recv()
  //write("tyck", ins)
  switch (ins.tag) {
  case Syntax.fun:
    assert(ins.annots.length <= 1)
    this.globals[ins.name] = {gs: ins.gs, domain: ins.bs.map(x => x.type), codomain: ins.retT}
    for (let name of ins.gs)
      this.ctx.push({tag: "uni", name})
    for (let {name, type} of ins.bs)
      this.ctx.push({tag: "var", name, type})

    if (ins.annots.length === 0)
      await this.check(ins.retT)
    else {
      try {
        await this.check(ins.retT)
        error("[no error]")
      } catch (e) {
        assertEq(e.message, ins.annots[0].text)
      }
    }
    assertEq((await this.ch.recv()).tag, Syntax.endfun) // invariant
    
    // check if all evars are solved? no
    //assert(this.ctx.)
    this.ctx = []
    break
  case Syntax.eof:
    return
  default:
    nonExhaustiveMatch(ins.tag)
  }
  }
}
}