import { toString, dbg, error, assert, assertL, assertEq, write, fuel, nonExhaustiveMatch, step, nextLast, it, findUniqueIndex, map, join } from './util.js';

import { Syntax } from "./syntax.js"

function mangle(path) {
  path = path.replaceAll("/", "$")
  path = path.replaceAll("-", "_")
  path = path === "let" ? "hlet" : path
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
    while (true) {
    let ins = this.nextIns()
    if (ins.tag === Syntax.endapp) break
    if (ins.tag !== Syntax.applam) {
      this.k--
      ixs.push(this.expr())
      continue
    }
    // generate trailing lambda
    ixs.push(this.emitSsa(`(${join(map(ins.ps,mangle))}) => {`))
    let retIx = this.expr()
    this.code += `  return ${retIx}\n  }\n`
    }
    let fun = ixs.shift()
    return this.emitSsa(`${fun}(${join(it(ixs))})`) 
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
    elimCode += `function ${item.name}$elim(self, ${join(map(item.cons, x=>x.name), ", ")}) {\n  switch (self.tag) {\n`
    for (let c of item.cons) {
      const ps = c.fields.map(x=>x.name)
      const bs = join(it(ps), ", ")
      let fullname = item.name +"$"+ c.name
      this.code += `function ${fullname}(${bs}) {\n`
      this.code += `  return {tag: Symbol.for("${c.name}"), ${bs}}\n}\n`
      let as = join(map(ps, x=>"self."+x), ", ")
      elimCode += `  case Symbol.for("${c.name}"): return ${c.name}(${as});\n`
    }
    elimCode += `  default: throw new Error("nonexhaustive: " + self.tag.description)\n`
    elimCode += "  }\n}\n"
    this.code += elimCode
    break
  case Syntax.let:
    this.code += `const ${mangle(item.name)} = (()=>{\n`
    let retIx = this.expr()
    this.code += `  return ${retIx}\n})()\n`
    this.nextVar = 0
    break
  case Syntax.fun:
    const bs = map(item.bs,x=>mangle(x.name))
    this.code += `function ${mangle(item.name)}(${join(bs, ", ")}) {\n`
    
    let retIx2 = this.expr()
    
    this.code += `  return ${retIx2}\n}\n`
    this.nextVar = 0
    break
  case Syntax.eof:
    this.code += `main()`
    return this.code
  default:
    nonExhaustiveMatch(item.tag)
  }
}
}