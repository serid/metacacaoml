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

export class ItemCodegen {
  constructor(root, item) {
    this.c = root.c
    this.root = root
    this.item = item // toplevel codegen
    this.k = 0
    this.nextVar = 0
  }

  nextIns() {
    return this.item.arena[this.k++]
  }
  
  pushCode(s) {
    this.root.code += s
  }
  
  alloc() {
    return "_" + this.nextVar++
  }

  emitSsa(e) {
    let ix = this.alloc()
    this.pushCode(`  const ${ix} = ${e}\n`)
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
      mangle(mapGet(this.c.itemTyck.methodNameAt, insLocation)) :
      ixs.shift()
    let retIx = this.emitSsa(`yield* ${fun}(${join(map(ixs,x=>x+","), " ")}`)
    
    // generate trailing lambdas
    while (true) {
    let ins2 = this.nextIns()
    if (ins2.tag === Syntax.endapp) break
    assertEq(ins2.tag, Syntax.applam)
    
    this.pushCode(`  function*(${join(map(ins2.ps,mangle))}) {\n`)
    let retIx = this.expr()
    this.pushCode(`  return ${retIx}\n  },\n`)
    }
    
    this.pushCode("  );\n")
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
    let ps = join(map(item.cons, x=>x.name))
    elimCode += `function* ${fullname}(self, ${ps}) {\n  switch (self.tag) {\n`
    for (let c of item.cons) {
      let ps = c.fields.map(x=>x.name)
      let bs = join(it(ps))
      let fullname = mangle(item.name+"/"+c.name)
      this.pushCode(`function* ${fullname}(${bs}) {\n  return {tag: Symbol.for("${c.name}"), ${bs}}\n}\n`)
      let as = join(map(ps, x=>"self."+x))
      elimCode += `  case Symbol.for("${c.name}"): return yield* ${c.name}(${as});\n`
    }
    elimCode += `  default: throw new Error("nonexhaustive: " + self.tag.description)\n`
    elimCode += "  }\n}\n"
    this.pushCode(elimCode)
    break
  case Syntax.let:
    this.pushCode(`const ${mangle(item.name)} = (function*() {\n`)
    let retIx = this.expr()
    this.pushCode(`  return ${retIx}\n})().next().value;\n`)
    this.nextVar = 0
    break
  case Syntax.fun:
    let bs = map(item.bs,x=>mangle(x.name))
    this.pushCode(`function* ${mangle(getFunName(item))}(${join(bs)}) {\n`)
    
    let retIx2 = this.expr()
    
    this.pushCode(`  return ${retIx2}\n}\n`)
    this.nextVar = 0
    break
  case Syntax.eof:
    this.pushCode(`main().next()`)
    return this.code
  default:
    nonExhaustiveMatch(item.tag)
  }
}
}

export class RootCodegen {
  constructor(c) {
    this.c = c // compiler
    this.code = `"use strict";\n`
  }
  
  getItemCodegen(item) {
    return new ItemCodegen(this, item)
  }
}