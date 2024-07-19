import { dbg, assert, assertL, assertEq, write, fuel, nonExhaustiveMatch, step, nextLast, it, unshiftYield, map, join } from './util.js';

import { spawn, Spsc, BufferedChRcvr } from './stream.js';

function isPrefix(s, i, w) {
  if (w.length > s.length - i) return false
  for (let j = 0; j < w.length; j++)
    if (s[i + j] != w[j]) return false
  return true
}

export class Syntax {
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
  
  errorLocation() {
    return this.compiler.errorLocation(this.i)
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
    assertL(this.tryWord(w), () =>  `expected "${w}" ` + this.errorLocation()) 
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
    assertL(id !== null, () => "expected ident " + this.errorLocation())
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
    return this.assertIdent()
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
    
    throw Error("expected expression " + this.errorLocation())
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
    throw Error("expected toplevel " + this.errorLocation())
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
  constructor(as, ch) {
    this.as = as
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
  //write(ins)
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
  constructor(as, ch) {
    this.as = as
    this.ch = ch
    this.globals = {}
    this.ctx = []
  }
  
// bidir.pdf: [Г]A
substitute(ty) {
  switch (ty.tag) {
  case "var":
    return ty
  case "arrow":
    return {tag: "arrow"}
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
async infer() {
  let ins = await this.ch.recv()
  write("infer", ins)
  switch (ins.tag) {
  case Syntax.native:
    return "any"
  case Syntax.use:
    let ix = this.ctx.findLastIndex(({tag, name}) => tag === "var" && name === ins.name)
    assertL(ix !== -1, () => "var not found " + this.compiler.errorAt(ins.span))
    return this.ctx[ix].type
  case Syntax.app:
    let ins2 = await this.ch.recv()
    write("infer app", ins2)
    if (ins2.tag === Syntax.endapp)
      return
    this.ch.unshift(ins2)
    let fty = await this.infer()
    write(fty)
    let aty = await this.infer()
    assert(dbg(await this.ch.recv()).tag === Syntax.endapp)
    return fty
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
  case Syntax.use:
  case Syntax.app:
    this.ch.unshift(ins)
    let ty2 = await this.infer()
    write(ty2)
    assert(ty === ty2)
    return
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
async tyck() {
  while (true) {
  let ins = await this.ch.recv()
  switch (ins.tag) {
  case Syntax.fun:
    this.globals[ins.name] = {gs: ins.gs, bs: ins.bs.map(x => x.type), retT: ins.retT}
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
    break
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
    let tyck = new Tyck(this, new BufferedChRcvr(a)).tyck()
    let cg = new Codegen(this, new BufferedChRcvr(b)).codegen()
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
  
  errorLocation(span) {
    return `at "${this.src.substring(span, span + 7)}"`
  }
  
  async compile() {
    return await new Analysis(this).analyze(new Syntax(this).syntax())
  }
}