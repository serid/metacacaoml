import { toString, dbg, error, assert, assertL, assertEq, write, fuel, nonExhaustiveMatch, step, nextLast, it, findUniqueIndex, map, join } from './util.js';

import { spawn, Spsc, BufferedChRcvr } from './stream.js';

function typeToString(ty) {
  switch (ty.tag) {
    case "any":
      return "any"
    case "var":
      return ty.name
    case "evar":
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

function isPrefix(s, i, w) {
  if (w.length > s.length - i) return false
  for (let j = 0; j < w.length; j++)
    if (s[i + j] != w[j]) return false
  return true
}

export class Syntax {
  static strlit = "strlit"
  static fun = "fun"
  static native = "native"
  static app = "app"
  static endapp = "endapp"
  static use = "use"
  static endfun = "endfun"
  static eof = "eof"

  constructor(compiler) {
    this.compiler = compiler
    this.s = compiler.src
    this.i = 0
  }
  
  notPastEof() {
    return this.i < this.s.length
  }
  
  checkInvariant() {
    assert(this.notPastEof(), "i out of bounds")
  }
  
  errorAt() {
    return this.compiler.errorAt(this.i)
  }
  
  peekWord(w) {
    return isPrefix(this.s, this.i, w)
  }
  
  tryWord(w) {
    if (!this.peekWord(w)) return false
    this.i += w.length
    return true
  }
  
  assertWord(w) {
    assertL(this.tryWord(w), () =>  `expected "${w}"` + this.errorAt()) 
  }
  
  peekChar() {
    this.checkInvariant()
    return this.s[this.i]
  }
  
  char() {
    this.checkInvariant()
    return this.s[this.i++]
  }
  
  tryWhitespace() {
    while (this.notPastEof() && (this.peekChar() === ' ' ||
      this.peekChar() === '\n'))
      this.i++
  }
  
  ident() {
    let id = ""
    if (!this.notPastEof() ||
      !/[a-zA-Z]/.test(this.peekChar()))
      return null
    while (this.notPastEof()) {
      let c = this.peekChar()
      if (!/[a-zA-Z]/.test(c))
        break
      id += c
      this.i++
    }
    return id
  }
  
  assertIdent() {
    let id = this.ident()
    assertL(id !== null, () => "expected ident" + this.errorAt())
    return id
  }
  
  stringLiteral(end) {
    let s = ""
    while (!this.tryWord(end))
      s += this.char()
    return s
  }
  
  type() {
    if (this.tryWord("[")) {
      let domain = []
      while (!this.tryWord("]")) {
        domain.push(this.type())
        this.tryWhitespace()
      }
      let codomain = this.type()
      return {tag: "arrow", domain, codomain}
    }
    if (this.tryWord("any"))
      return {tag: "any"}
    return {tag: "var", name: this.assertIdent()}
  }
  
  tryAngledGenerics() {
    let ns = []
    if (!this.tryWord("<")) return ns
    while (!this.tryWord(">")) {
      ns.push(this.assertIdent())
      this.tryWhitespace()
    }
    return ns
  }
  
  binding() {
    let name = this.assertIdent()
    this.tryWhitespace()
    this.assertWord(":")
    this.tryWhitespace()
    let type = this.type()
    this.tryWhitespace()
    return { name, type }
  }
  
  bindings() {
    if (this.tryWord(")")) return []
    let out = [this.binding()]
    while (!this.tryWord(")")) {
      fuel.step()
      this.assertWord(",")
      this.tryWhitespace()
      out.push(this.binding())
      this.tryWhitespace()
    }
    return out
  }
  
  *expr() {
    if (this.tryWord('"')) {
      yield { tag: Syntax.strlit, span: this.i, data: this.stringLiteral('"')}
      return
    }
    if (this.tryWord("native[|")) {
      yield {tag: Syntax.native, span: this.i, code: this.stringLiteral("|]")}
      return
    }
    if (this.tryWord("(")) {
      yield {tag: Syntax.app, span: this.i}
      while (!this.tryWord(")")) {
        yield* this.expr()
        this.tryWhitespace()
      }
      yield {tag: Syntax.endapp, span: this.i}
      return
    }
    let span = this.i
    let name = this.ident()
    if (name !== null) {
      yield {tag: Syntax.use, span, name}
      return
    }
    
    error("expected expression" + this.errorAt())
  }
  
  *toplevel() {
    let span = this.i
    if (this.tryWord("fun")) {
      this.tryWhitespace()
      let name = this.assertIdent()
      let gs = this.tryAngledGenerics()
      this.assertWord("(")
      let bs = this.bindings()
      this.tryWhitespace()
      this.assertWord(":")
      this.tryWhitespace()
      let retT = this.type()
      this.tryWhitespace()
      this.assertWord("=")
      this.tryWhitespace()
    
      yield {tag: Syntax.fun, span, name, gs, bs, retT}
      yield* this.expr()
      yield {tag: Syntax.endfun, span: this.i}
      return
    }
    error("expected toplevel" + this.errorAt())
  }
  
  *syntax() {
    this.tryWhitespace()
    while (this.notPastEof()) {
      fuel.step()
      yield* this.toplevel()
      this.tryWhitespace()
    }
    yield {tag: Syntax.eof, span: this.i}
  }
}

class Codegen {
  constructor(c, ch) {
    this.c = c // compiler
    this.ch = ch
    this.code = ""
    this.nextVar = 0
  }
  
  alloc() {
    return "_" + this.nextVar++
  }
  
  emitSsa(e) {
    let ix = this.alloc()
    this.code += `  const ${ix} = ${e}\n`
    return ix
  }
  
async expr() {
  let ins = await this.ch.recv()
  switch (ins.tag) {
  case Syntax.strlit:
    return `"${ins.data}"`
  case Syntax.native:
    return this.emitSsa(ins.code)
  case Syntax.use:
    return ins.name
  case Syntax.app:
    let ixs = []
    while (true) {
    let ins = await this.ch.recv()
    if (ins.tag === Syntax.endapp) break
    this.ch.unshift(ins)
    ixs.push(await this.expr())
    }
    let fun = ixs.shift()
    return this.emitSsa(`${fun}(${join(it(ixs))})`) 
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
async codegen() {
  while (true) {
  let ins = await this.ch.recv()
  //write("cg", ins)
  switch (ins.tag) {
  case Syntax.fun:
    const bs = map(ins.bs, ({name}) => name)
    this.code += `function ${ins.name}(${join(bs, ", ")}) {\n`
    
    let retIx = await this.expr()
    assertEq((await this.ch.recv()).tag, Syntax.endfun)
    
    this.code += `  return ${retIx}\n}\n`
    this.nextVar = 0
    break
  case Syntax.eof:
    return this.code
  default:
    nonExhaustiveMatch(ins.tag)
  }
  }
}
}

class Tyck {
  constructor(c, ch) {
    this.c = c // compiler
    this.ch = ch
    this.globals = Object.create(null)
    this.ctx = []
  }
  
// static map(ty)

// Replace universal variables with existentials
instantiate(vars, ty) {
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
  return Tyck.instantiate0(map, ty)
}

static instantiate0(varMap, ty) {
  write("instantiate0", varMap, ty)
  switch (ty.tag) {
  case "arrow":
    return {tag: "arrow",
      domain: ty.domain.map(this.instantiate0.bind(this, varMap)),
      codomain: this.instantiate0(varMap, ty.codomain)
    }
  case "var":
    if (varMap[ty.name] === undefined) return ty
    return {...ty, tag: "evar"}
  case "any":
  case "evar":
    return ty
  default:
    nonExhaustiveMatch(ty.tag)
  }
}
  
// bidir.pdf: [Г]A
substitute(ty) {
  switch (ty.tag) {
  case "any":
  case "var":
    return ty
  case "evar":
    let ix = findUniqueIndex(this.ctx, ({tag, name}) => tag === "esolve" && name === ty.name)
    
    // evar not solved, but is it even declared? 
    if (ix === -1)
      ix = findUniqueIndex(this.ctx, ({tag, name}) => tag === "evar" && name === ty.name)
    assertL(ix !== -1, () => "evar not found" + this.compiler.errorAt(ins.span))
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

solveEvarTo(name, value) {
  write("solve evar", name, value)
  assert(!this.ctx.some(
    x => x.tag === "esolve" && x.name === name))

  let ix = findUniqueIndex(this.ctx,
    x => x.tag === "evar" && x.name === name)
  assert(ix !== -1)
  this.ctx[ix] = {...this.ctx[ix], tag: "esolve", value: value}
  //todo: occurs check
}

unify(ty1, ty2) {
  write("unify", ty1, ty2, this.ctx) 
  if (ty1.tag === "evar") {
    this.solveEvarTo(ty1.name, ty2)
    return
  }
  if (ty2.tag === "evar") {
    this.solveEvarTo(ty2.name, ty1)
    return
  }
  if (ty1.tag === "any" || ty2.tag === "any")
    return
  
  switch (ty1.tag) {
    case "var":
      assert(ty2.tag === "var")
      assert(ty1.name === ty2.name)
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
  write("infer", ins)
  switch (ins.tag) {
  case Syntax.strlit:
    return {tag: "var", name: "String"}
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
      //todo: capture-avoiding substitution: ensure that evars emitted by inst are not present in context
      return this.instantiate(fun.gs, {tag: "arrow", domain: fun.domain, codomain: fun.codomain}) 
    error("var not found" + this.compiler.errorAt(ins.span))
  case Syntax.app:
    write("infer app")
    let fty = this.substitute(await this.infer())
    write("fty", fty)
    assertEq(fty.tag, "arrow") //todo evar
    
    let pars = fty.domain
    for (let i = 0; i < pars.length; i++) {
      let ins2 = await this.ch.recv()
      if (ins2.tag === Syntax.endapp)
        error("expected argument of type " +
        typeToString(pars[i]) +
        this.c.errorAt(ins2.span))
      this.ch.unshift(ins2)
      await this.check(pars[i])
    }
    
    assertEq((await this.ch.recv()).tag, Syntax.endapp)
    return fty.codomain
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
async check(ty) {
  let ins = await this.ch.recv()
  write("check", ty, ins)
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
    this.globals[ins.name] = {gs: ins.gs, domain: ins.bs.map(x => x.type), codomain: ins.retT}
    for (let name of ins.gs)
      this.ctx.push({tag: "uni", name})
    for (let {name, type} of ins.bs)
      this.ctx.push({tag: "var", name, type})
    
    await this.check(ins.retT)
    assertEq((await this.ch.recv()).tag, Syntax.endfun)
    
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

class Analysis {
  constructor(compiler) {
    this.compiler = compiler
  }
  
  async analyze(ss) {
    let a = new Spsc()
    let b = new Spsc()
    let tyck = new Tyck(this.compiler, new BufferedChRcvr(a)).tyck()
    let cg = new Codegen(this.compiler, new BufferedChRcvr(b)).codegen()
    spawn(async () => { for (let i of ss) {
      write("analyze", i)
      await a.send(i)
      await b.send(i)
    }})
    let [_, code] = await Promise.all([tyck, cg])
    return code
  }
}

export class Compiler {
  constructor(src) {
    this.src = src
  }
  
  errorAt(span) {
    return ` at "${this.src.substring(span, span + 7)}"`
  }
  
  async compile() {
    return await new Analysis(this).analyze(new Syntax(this).syntax())
  }
}