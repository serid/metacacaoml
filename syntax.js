import { toString, dbg, error, assert, assertL, assertEq, write, fuel, nonExhaustiveMatch, step, nextLast, getOne, it, findUniqueIndex, map, join } from './util.js';

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
  
  #type_(es) {
    let ins = getOne(es)
    switch (ins.tag) {
    case Syntax.use:
      // drops the span
      return {tag: ins.tag, name: ins.name}
    case Syntax.app:
      let cons = this.#type_(es)
      let args = []
      while (true) {
        let arg = this.#type_(es)
        if (arg === null) break
        args.push(arg)
      }
      return {tag: "app", cons, args}
    default:
      return null
    }
  }
  
  type() {
    if (this.tryWord("[")) {
      let domain = []
      while (!this.tryWord("]"))
        domain.push(this.type())
      let codomain = this.type()
      return {tag: "arrow", domain, codomain}
    }
    if (this.tryWord("any"))
      return {tag: "any"}
    return this.#type_(this.expr())
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
      while (!this.tryWord(")"))
        yield* this.expr()
      while (true) {
        if (this.tryWord("λ")) {
          let ps = this.idents(".")
          yield {tag: Syntax.applam, span: this.i, ps}
          yield* this.expr()
          continue
        }
        if (this.tryWord("{")) {
          let ps = this.idents(".")
          yield { tag: Syntax.applam, span: this.i, ps }
          yield* this.expr()
          this.assertWord("}")
          continue
        }
        break
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
        this.assertWord("(")
        let name = this.assertIdent()
        
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
      
      yield {tag: Syntax.cls, name, gs, cons}
    } else if (this.tryWord("let")) {
      let name = this.assertIdent()
      this.assertWord(":")
      let retT = this.type()
      this.assertWord("=")
    
      yield {tag: Syntax.let, span, name, retT}
      yield* this.expr()
    } else if (this.tryWord("fun")) {
      this.assertWord("(")
      let name = this.assertIdent()
      let gs = this.generics()
      let bs = this.bindings()
      this.assertWord(":")
      let retT = this.type()
      this.assertWord("=")
    
      yield {tag: Syntax.fun, span, name, gs, bs, retT, annots}
      yield* this.expr()
      yield {tag: Syntax.endfun, span: this.i}
    } else error("expected toplevel" + this.errorAt())
  }
  
  *syntax() {
    this.tryWhitespace()
    while (this.notPastEof()) {
      fuel.step()
      yield* this.toplevel()
    }
    yield {tag: Syntax.eof, span: this.i}
  }
}