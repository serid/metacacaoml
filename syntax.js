import { toString, dbg, error, assert, assertL, assertEq, write, fuel, nonExhaustiveMatch, step, nextLast, getOne, it, findUniqueIndex, map } from './util.js';

function isPrefix(s, i, w) {
  if (w.length > s.length - i) return false
  for (let j = 0; j < w.length; j++)
    if (s[i + j] != w[j]) return false
  return true
}

export class Syntax {
  static cls = Symbol("cls")
  static strlit = "strlit"
  static fun = "fun"
  static native = "native"
  static app = "app"
  static endapp = "endapp"
  static use = "use"
  static endfun = "endfun"
  static eof = "eof"
  static applam = Symbol("applam")
  static let = Symbol("let")
  static arrow = Symbol("arrow")
  static any = Symbol("any")
  static endarrow = Symbol("endarrow")
  static nakedfun = Symbol("naked-fun")

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
  
  tryWordNoWhitespace(w) {
    if (!this.peekWord(w)) return false
    this.i += w.length
    return true
  }
  
  tryWord(w) {
    let b = this.tryWordNoWhitespace(w)
    if (!b) return false
    this.tryWhitespace()
    return true
  }
  
  assertWord(w) {
    assertL(this.tryWord(w), () => `expected "${w}"` + this.errorAt()) 
  }
  
  peekChar() {
    this.checkInvariant()
    return this.s[this.i]
  }
  
  char() {
    this.checkInvariant()
    return this.s[this.i++]
  }
  
  tryComment() {
    while (true) {
    if (this.tryWord("#{")) {
      while (this.notPastEof() && this.peekChar() !== '}')
        if (!this.tryComment())
          this.i++
      this.i++
    } else if (this.tryWord("#")) {
      while (this.notPastEof() && this.peekChar() !== '\n') this.i++
      this.i++
    } else break
    }
  }
  
  tryWhitespace() {
    while (this.notPastEof()) {
      this.tryComment()
      if (this.peekChar() !== ' ' &&
        this.peekChar() !== '\n')
        break
      this.i++
    }
  }
  
  ident() {
    let rule = /[a-zA-Z0-9\-]/
    let id = ""
    if (!this.notPastEof() ||
      !rule.test(this.peekChar()))
      return null
    while (this.notPastEof()) {
      if (this.tryWord("/"))
        id += "/"

      let c = this.peekChar()
      if (!rule.test(c))
        break
      id += c
      this.i++
    }
    this.tryWhitespace()
    return id
  }
  
  assertIdent() {
    let id = this.ident()
    assertL(id !== null, () => "expected ident" + this.errorAt())
    return id
  }
  
  stringLiteral(end) {
    let s = ""
    while (!this.tryWordNoWhitespace(end))
      s += this.char()
    this.tryWhitespace()
    return s
  }
  
  #normalize(es) {
    let ins = getOne(es)
    //write(ins)
    switch (ins.tag) {
    case Syntax.any:
      return {tag:"any", span:ins.span}
    case Syntax.use:
      return {tag:"use", span:ins.span, name:ins.name}
    case Syntax.app:
      let cons = this.#normalize(es)
      let args = []
      while (true) {
        let arg = this.#normalize(es)
        if (arg === null) break
        args.push(arg)
      }
      assertEq(cons.tag, "use")
      return {tag:"cons", name:cons.name, args}
    case Syntax.arrow:
      let domain = []
      while (true) {
        let ty = this.#normalize(es)
        if (ty === null) break
        domain.push(ty)
      }
      let codomain = this.#normalize(es)
      return {tag:"arrow", domain, codomain}
    case Syntax.endapp:
    case Syntax.endarrow:
      return null
    default:
      nonExhaustiveMatch(ins.tag)
    }
  }
  
  type() {
    return {tag: Syntax.nakedfun,
      span: this.i,
      arena: this.expr()
    }
  }
  
  idents(end) {
    let ns = []
    while (!this.tryWord(end))
      ns.push(this.assertIdent())
    return ns
  }
  
  generics() {
    let gs = []
    while (this.tryWord("'")) {
      gs.push(this.assertIdent())
    }
    return gs
  }
  
  binding() {
    let name = this.ident()
    if (name === null) return null
    this.assertWord(":")
    let type = this.type()
    return { name, type }
  }
  
  bindings() {
    let bs = []
    while (!this.tryWord(")")) {
      fuel.step()
      bs.push(this.binding())
    }
    return bs
  }
  
  // returns an array of instructions
  expr() {
    let span = this.i
    let insQueue = []
    if (this.tryWord('"')) {
      insQueue.push({tag: Syntax.strlit, span, data: this.stringLiteral('"')})
    } else if (this.tryWord("native[|")) {
      insQueue.push({tag: Syntax.native, span, code: this.stringLiteral("|]")})
    } else if (this.tryWord("(")) {
      insQueue = this.expr()
      this.assertWord(")")
    } else if (this.tryWord("@any")) {
      return [{tag:Syntax.any, span}]
    } else if (this.tryWord("[")) {
      insQueue.push({tag:Syntax.arrow, span:this.i})
      while (!this.tryWord("]"))
        insQueue.push(...this.expr())
      insQueue.push({tag:Syntax.endarrow, span:this.i})
      insQueue.push(...this.expr())
      return insQueue
    } else {
      let name = this.ident()
      assertL(name !== null, ()=>"expected expression" + this.errorAt())
      insQueue.push({tag: Syntax.use, span, name})
    }
    
    while (true) {
    span = this.i
    
    let metName = null
    if (this.tryWord(".")) {
      metName = this.assertIdent()
    }
      
    if (this.tryWord("(")) {
      insQueue.unshift({tag: Syntax.app, span, metName})
      while (!this.tryWord(")"))
        insQueue.push(...this.expr())
      while (true) {
        span = this.i
        if (this.tryWord("λ")) {
          let ps = this.idents(".")
          insQueue.push({tag: Syntax.applam, span, ps})
          insQueue.push(...this.expr())
          continue
        }
        if (this.tryWord("{")) {
          let ps = this.idents(".")
          insQueue.push({tag: Syntax.applam, span, ps})
          insQueue.push(...this.expr())
          this.assertWord("}")
          continue
        }
        break
      }
      insQueue.push({tag: Syntax.endapp, span: this.i})
      continue
    }
    break
    } // end postfix loop
    return insQueue
  }
  
  toplevel() {
    let annots = []
    if (this.tryWord("@")) {
      let name = this.assertIdent()
      this.assertWord('(')
      let text = this.stringLiteral(')')
      annots.push({name, text})
    }

    let span = this.i
    if (this.tryWord("class")) {
      let name = this.assertIdent()
      let gs = this.generics()

      let cons = []
      while (!this.tryWord("end")) {
        this.assertWord("|")
        let name = this.assertIdent()
        this.assertWord("(")
        
        let fields = []
        let c = 0
        while (!this.tryWord(")")) {
          fields.push({
            name: "_" + c++, 
            type: this.type()
          })
        }
        
        cons.push({name, fields})
      }
      
      return {tag: Syntax.cls, span, name, gs, cons}
    } else if (this.tryWord("let")) {
      let name = this.assertIdent()
      this.assertWord(":")
      let retT = this.type()
      this.assertWord("=")
    
      return {tag: Syntax.let, span, name, retT, arena: this.expr()}
    } else if (this.tryWord("fun")) {
      let isMethod = this.tryWord(".")
      let name = this.assertIdent()
      this.assertWord("(")
      let gs = this.generics()
      let bs = this.bindings()
      this.assertWord(":")
      let retT = this.type()
      this.assertWord("=")
    
      let arena = this.expr()
      return {tag: Syntax.fun, span, isMethod,name, gs, bs, retT, annots, arena}
    } else error("expected toplevel" + this.errorAt())
  }
  
  *syntax() {
    this.tryWhitespace()
    while (this.notPastEof()) {
      fuel.step()
      yield this.toplevel()
    }
    yield {tag:Syntax.eof, span: this.i}
  }
}
