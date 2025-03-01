import { assertEq, nonExhaustiveMatch, map, join, any } from './util.ts'

import { Syntax } from "./syntax.ts"
import { Compiler } from './compile.ts'

export function mangle(path: string) {
  // hazard: unicode!!
  // characters found using shapecatcher.com
  path = path.replaceAll("/", "ᐅ")
  path = path.replaceAll("-", "ᜭ")
  path = path === "let" ? "Ξlet" : path
  return path
}

export class ItemCodegen {
  c: Compiler
  root: RootCodegen
  item: any
  fixtureNames: string[]
  k: number
  nextVar: number
  code: string
  
  constructor(root: RootCodegen, item: any, fixtureNames: string[]) {
    this.c = root.c
    this.root = root // toplevel codegen
    this.item = item
    this.fixtureNames = fixtureNames
    this.k = 0
    this.nextVar = 0
    this.code = ""
  }
  
  ins() {
    return this.item.arena[this.k]
  }

  nextIns() {
    return this.item.arena[this.k++]
  }
  
  pushCode(s: string) {
    this.code += s
  }
  
  alloc() {
    return "_" + this.nextVar++
  }

  emitSsa(e: string) {
    let ix = this.alloc()
    this.pushCode(`  const ${ix} = ${e}\n`)
    return ix
  }

emitYieldStar(what: string): string {
  let yieldReturnVar = this.alloc()
  this.pushCode(`  let ${yieldReturnVar}; while (true) { let pair = ${what}.next(); if (pair.done) { ${yieldReturnVar} = pair.value; break } yield pair.value }\n`)
  return yieldReturnVar
}
  
expr(): string {
  let insLocation = this.k
  let ins = this.nextIns()
  switch (ins.tag) {
  case Syntax.strlit:
    return `"${ins.data}"`
  case Syntax.native:
    return ins.code
  case Syntax.int:
    return `${ins.data}`
  case Syntax.use:
    let name = ins.name
    return mangle(
      this.fixtureNames.includes(name)
      ? "fixtures."+name
      : name)
  case Syntax.array: {
    let ixs: string[] = []
    while (this.ins().tag!==Syntax.endarray)
      ixs.push(this.expr())
    this.k++
    return this.emitSsa(`[${join(ixs)}]`)
  }
  case Syntax.app:
    let ixs: string[] = []
    // generate strict arguments
    while (true) {
    let ins = this.ins()
    if (ins.tag === Syntax.endapp) break
    if (ins.tag === Syntax.applam) break
    ixs.push(this.expr())
    }
    
    // For methods, fetch full name produced by tyck, otherwise the fun is first expression
    //write(ins)
    let fun = ins.metName !== null ?
      mangle(this.c.itemTyck.getMethodNameAt(insLocation)) :
      ixs.shift()
    
    // A contrived codegen spell indeed
    // Put no comas when no normal arguments are present
    // Put a coma after each normal argument since they are followed
    // by lambdas
    let genIx = this.emitSsa(`${fun}(${join(map(ixs,x=>x+","), " ")}`)
    
    // generate trailing lambdas
    while (true) {
    let ins = this.nextIns()
    if (ins.tag === Syntax.endapp) break
    assertEq(ins.tag, Syntax.applam)
    
    this.pushCode(`  function*(${join(map(ins.ps,mangle))}) {\n`)
    let retIx = this.expr()
    this.pushCode(`  return ${retIx}\n  },\n`)
    }
    
    this.pushCode("  );\n")
    return this.emitYieldStar(genIx)
    
  // types
  
  case Syntax.any:
    return `{tag:"any"}`
  case Syntax.arrow:
    let domain: string[] = []
    while (this.ins().tag !== Syntax.endarrow)
      domain.push(this.expr())
    this.k++
    let codomain = this.expr()
    return `{tag:"arrow", domain:[${join(domain)}], codomain:${codomain}}`
  default:
    nonExhaustiveMatch(ins.tag)
  }
}
  
codegen_() {
  let item = this.item

  //write("cg", ins)
  switch (item.tag) {
  case Syntax.cls:
    let elimCode = ""
    let fullname = mangle(item.name+"/elim")
    let ps = join(map(item.conss, x=>any(x).name))
    elimCode += `function* ${fullname}(self, ${ps}) {\n  switch (self.tag) {\n`
    for (let c of item.conss) {
      let ps = c.fields.map(x=>x.name)
      let bs = join(ps)
      let fullname = mangle(item.name+"/"+c.name)
      this.pushCode(`function* ${fullname}(${bs}) {\n  return {tag: Symbol.for("${c.name}"), ${bs}}\n}\n`)
      let as = join(map(ps, x=>"self."+x))
      //todo: eliminate yield*
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
    break
  case Syntax.fun:
    let bs = map(item.bs,x=>mangle(any(x).name))
    this.pushCode(`function* ${mangle(this.c.itemTyck.funName)}(${join(bs)}) {\n`)
    let retIx2 = this.expr()
    
    this.pushCode(`  return ${retIx2}\n}\n`)
    break
  case Syntax.nakedfun:
    this.pushCode(`  return ${this.expr()}`)
    break
  case Syntax.eof:
    this.pushCode(`main().next()`)
    break
  default:
    nonExhaustiveMatch(item.tag)
  }
  return this.code
}
codegen() {
  return this.c.itemNetwork.memoize(
    "codegen-item", [], this.codegen_.bind(this))
}
}

export class RootCodegen {
  c: any
  code: string
  
  constructor(c: any) {
    this.c = c // compiler
    this.code = `"use strict";\n`
  }
  
  getItemCodegen(item: any, fixtureNames: string[]) {
    return new ItemCodegen(this, item, fixtureNames)
  }

  /*
  initializeDucts(network: Network) {
    network.register("codegen-type-constructor", () => {
      error("")
    })
  }
  */
}