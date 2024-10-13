import { toString, dbg, error, assert, assertL, assertEq, write, fuel, nonExhaustiveMatch, mapGet, step, nextLast, it, findUniqueIndex, map, join } from './util.js';

import { Syntax } from "./syntax.js"
import { getFunName } from "./huk.js"

function mangle(path) {
  // hazard: unicode!!
  // characters found using shapecatcher.com
  path = path.replaceAll("/", "ᐅ")
  path = path.replaceAll("-", "ᜭ")
  path = path === "let" ? "Ξlet" : path
  return path
}

export class Codegen {
  constructor(c, ch) {
    this.c = c // compiler
    this.code = `"use strict";\n`
    
    this.item = null
    this.k = -13
    this.nextVar = -13
  }

  setItem(item) {
    this.item = item
    this.k = 0
    this.nextVar = 0
  }

  nextIns() {
    return this.item.arena[this.k++]
  }
  
  alloc() {
    return "_" + this.nextVar++
  }

  emitSsa(e) {
    let ix = this.alloc()
    this.code += `  const ${ix} = ${e}\n`
    return ix
  }
  
expr() {
  let insLocation = this.k
  let ins = this.nextIns()
  switch (ins.tag) {
  case Syntax.strlit:
    return `"${ins.data}"`
  case Syntax.native:
    return ins.code
  case Syntax.use:
    return mangle(ins.name)
  case Syntax.app:
    let ixs = []
    // generate strict arguments
    while (true) {
    let ins2 = this.nextIns()
    this.k--
    if (ins2.tag === Syntax.endapp) break
    if (ins2.tag === Syntax.applam) break
    ixs.push(this.expr())
    }
    
    // For methods, fetch full name produced by tyck, otherwise the fun is first expression
    //write(ins)
    let fun = ins.metName !== null ?
      mangle(mapGet(this.c.tyck.methodNameAt, insLocation)) :
      ixs.shift()
    let retIx = this.emitSsa(`yield* ${fun}(${join(map(ixs,x=>x+","), " ")}`)
    
    // generate trailing lambdas
    while (true) {
    let ins2 = this.nextIns()
    if (ins2.tag === Syntax.endapp) break
    assertEq(ins2.tag, Syntax.applam)
    
    this.code += `  function*(${join(map(ins2.ps,mangle))}) {\n`
    let retIx = this.expr()
    this.code += `  return ${retIx}\n  },\n`
    }
    
    this.code += "  );\n"
    return retIx
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
codegen() {
  let item = this.item

  //write("cg", ins)
  switch (item.tag) {
  case Syntax.cls:
    let elimCode = ""
    let fullname = mangle(item.name+"/elim")
    elimCode += `function* ${fullname}(self, ${join(map(item.cons, x=>x.name))}) {\n  switch (self.tag) {\n`
    for (let c of item.cons) {
      let ps = c.fields.map(x=>x.name)
      let bs = join(it(ps))
      let fullname = mangle(item.name+"/"+c.name)
      this.code += `function* ${fullname}(${bs}) {\n`
      this.code += `  return {tag: Symbol.for("${c.name}"), ${bs}}\n}\n`
      let as = join(map(ps, x=>"self."+x))
      elimCode += `  case Symbol.for("${c.name}"): return yield* ${c.name}(${as});\n`
    }
    elimCode += `  default: throw new Error("nonexhaustive: " + self.tag.description)\n`
    elimCode += "  }\n}\n"
    this.code += elimCode
    break
  case Syntax.let:
    this.code += `const ${mangle(item.name)} = (function*() {\n`
    let retIx = this.expr()
    this.code += `  return ${retIx}\n})().next().value;\n`
    this.nextVar = 0
    break
  case Syntax.fun:
    let bs = map(item.bs,x=>mangle(x.name))
    this.code += `function* ${mangle(getFunName(item))}(${join(bs)}) {\n`
    
    let retIx2 = this.expr()
    
    this.code += `  return ${retIx2}\n}\n`
    this.nextVar = 0
    break
  case Syntax.eof:
    this.code += `main().next()`
    return this.code
  default:
    nonExhaustiveMatch(item.tag)
  }
}
}