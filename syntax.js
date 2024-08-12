import { toString, dbg, error, assert, assertL, assertEq, write, fuel, nonExhaustiveMatch, step, nextLast, it, findUniqueIndex, map, join } from './util.js';

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
  static applam = Symbol("applam")

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
    return {tag: "use", name: this.assertIdent()}
  }
  
  idents(end) {
    let ns = []
    while (!this.tryWord(end))
      ns.push(this.assertIdent())
    return ns
  }
  
  tryAngledGenerics() {
    if (!this.tryWord("<")) return []
    return this.idents(">")
  }
  
  binding() {
    let name = this.assertIdent()
    this.assertWord(":")
    let type = this.type()
    return { name, type }
  }
  
  bindings() {
    if (this.tryWord(")")) return []
    let out = [this.binding()]
    while (!this.tryWord(")")) {
      fuel.step()
      this.assertWord(",")
      out.push(this.binding())
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
      while (!this.tryWord(")"))
        yield* this.expr()
      if (this.tryWord("λ")) {
        let ps = this.idents(",")
        yield {tag: Syntax.applam, span: this.i, ps}
        yield* this.expr()
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
    if (this.tryWord("fun")) {
      let name = this.assertIdent()
      let gs = this.tryAngledGenerics()
      this.assertWord("(")
      let bs = this.bindings()
      this.assertWord(":")
      let retT = this.type()
      this.assertWord("=")
    
      yield {tag: Syntax.fun, span, name, gs, bs, retT, annots}
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
    }
    yield {tag: Syntax.eof, span: this.i}
  }
}