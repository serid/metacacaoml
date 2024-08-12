import { toString, dbg, error, assert, assertL, assertEq, write, fuel, nonExhaustiveMatch, step, nextLast, it, findUniqueIndex, map, join } from './util.js';

import { Syntax } from "./syntax.js"

export class Codegen {
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
    if (ins.tag !== Syntax.applam) {
      this.ch.unshift(ins)
      ixs.push(await this.expr())
      continue
    }
    // generate trailing lambda
    ixs.push(this.emitSsa(`(${join(it(ins.ps))}) -> {`))
    let retIx = await this.expr()
    this.code += `  return ${retIx}\n  }\n`
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