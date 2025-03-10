import { assertEq, nonExhaustiveMatch, join, ObjectSet, setContains } from './util.ts'

import { Syntax } from "./syntax.ts"
import { CompileError, Compiler } from './compile.ts'

export function mangle(path: string) {
  // hazard: unicode!!
  // characters found using shapecatcher.com
  path = path.replaceAll("/", "ᐅ")
  path = path.replaceAll("-", "ᜭ")
  if (["let"].includes(path)) path = "Ξ"+path
  return path
}

export class ItemCodegen {
  c: Compiler
  root: RootCodegen
  item: any
  fixtureNames: ObjectSet
  k: number // points one past the current instruction
  nextVar: number
  code: string[]
  
  constructor(root: RootCodegen, item: any, fixtureNames: ObjectSet) {
    this.c = root.c
    this.root = root // toplevel codegen
    this.item = item
    this.fixtureNames = fixtureNames
    this.k = 0
    this.nextVar = 0
    this.code = []
  }

  ins() {
    return this.item.arena[Math.max(this.k-1, 0)]
  }
  
  nextIns() {
    return this.item.arena[this.k]
  }

  stepIns() {
    return this.item.arena[this.k++]
  }
  
  alloc() {
    return "_" + this.nextVar++
  }

  emitSsa(e: string) {
    let ix = this.alloc()
    this.code.push(`  const ${ix} = ${e}\n`)
    return ix
  }

emitYieldStar(what: string): string {
  let yieldReturnVar = this.alloc()
  this.code.push(`  let ${yieldReturnVar}; while (true) { let pair = ${what}.next(); if (pair.done) { ${yieldReturnVar} = pair.value; break } yield pair.value }\n`)
  return yieldReturnVar
}
  
expr(): string {
  try {
  let insLocation = this.k
  let ins = this.stepIns()
  switch (ins.tag) {
  case Syntax.strlit:
    return `"${ins.data}"`
  case Syntax.native:
    return ins.code
  case Syntax.int:
    return `${ins.data}`
  case Syntax.use:
    let name = ins.name
    return setContains(this.fixtureNames, name) ?
      "__fixtures__."+name : name
  case Syntax.array: {
    let ixs: string[] = []
    while (this.nextIns().tag!==Syntax.endarray)
      ixs.push(this.expr())
    this.k++
    return this.emitSsa(`[${join(ixs)}]`)
  }
  case Syntax.app:
    let ixs: string[] = []
    // generate strict arguments
    while (![Syntax.endapp, Syntax.applam].includes(this.nextIns().tag))
      ixs.push(this.expr())
    
    // For methods, fetch full name produced by tyck, otherwise the fun is first expression
    //write(ins)
    let fun = ins.metName !== null ?
      this.c.itemTyck.getMethodNameAt(insLocation) :
      ixs.shift()
    
    // A contrived codegen spell indeed
    // Put no commas when no normal arguments are present
    // Put a comma after each normal argument since they are followed
    // by lambdas
    let genIx = this.emitSsa(`${fun}(${ixs.map(x=>x+",").join(" ")}`)
    
    // generate trailing lambdas
    while (true) {
    let ins = this.stepIns()
    if (ins.tag === Syntax.endapp) break
    assertEq(ins.tag, Syntax.applam)
    
    this.code.push(`  function*(${join(ins.ps)}) {\n`)
    let retIx = this.expr()
    this.code.push(`  return ${retIx}\n  },\n`)
    }
    
    this.code.push("  );\n")
    return this.emitYieldStar(genIx)
    
  // types
  
  case Syntax.any:
    return `{tag:"any"}`
  case Syntax.arrow:
    let domain: string[] = []
    while (this.nextIns().tag !== Syntax.endarrow)
      domain.push(this.expr())
    this.k++
    let codomain = this.expr()
    return `{tag:"arrow", domain:[${join(domain)}], codomain:${codomain}}`
  default:
    nonExhaustiveMatch(ins.tag)
  }
  } catch (e) {
    throw new CompileError(this.ins().span, undefined, undefined, { cause: e })
  }
}
  
codegen_() {
  try {
  let item = this.item

  //write("cg", ins)
  switch (item.tag) {
  case Syntax.cls:
    let elimCode = []
    let ps = join(item.conss.map(x=>x.name))
    elimCode.push(`function* ${item.name}ᐅelim(self, ${ps}) {\n  switch (self.tag) {\n`)
    for (let c of item.conss) {
      let ps = c.fields.map(x=>x.name)
      let bs = join(ps)
      let fullname = item.name+"ᐅ"+c.name
      this.code.push(`function* ${fullname}(${bs}) {\n  return {tag: Symbol.for("${c.name}"), ${bs}}\n}\n`)
      let as = join(ps.map(x=>"self."+x))
      //todo: eliminate yield*
      elimCode.push(`  case Symbol.for("${c.name}"): return yield* ${c.name}(${as});\n`)
    }
    elimCode.push(`  default: throw new Error("nonexhaustive: " + self.tag.description)\n`)
    elimCode.push("  }\n}\n")
    this.code.push(elimCode.join(""))
    break
  case Syntax.let:
    this.code.push(`const ${item.name} = (function*() {\n`)
    let retIx = this.expr()
    this.code.push(`  return ${retIx}\n})().next().value;\n`)
    break
  case Syntax.fun:
    let bs = item.bs.map(x=>x.name)
    this.code.push(`function* ${this.c.itemTyck.funName}(${join(bs)}) {\n`)
    let retIx2 = this.expr()
    
    this.code.push(`  return ${retIx2}\n}\n`)
    break
  case Syntax.nakedfun:
    this.code.push(`  return ${this.expr()}`)
    break
  default:
    nonExhaustiveMatch(item.tag)
  }
  } catch (e) {
    if (e.constructor === CompileError) throw e
    throw new CompileError(this.item.span, undefined, undefined, { cause: e })
  }
  return this.code.join("")
}
codegen() {
  return this.c.itemNetwork.memoize(
    "codegen-item", [], this.codegen_.bind(this))
}
}

export class RootCodegen {
  c: any
  code: string[]
  
  constructor(c: any) {
    this.c = c // compiler
    this.code = [`"use strict";\n`]
  }
  
  getItemCodegen(item: any, fixtureNames: ObjectSet) {
    return new ItemCodegen(this, item, fixtureNames)
  }

  getCode(): string {
    this.code.push("main().next()")
    return this.code.join("")
  }

  /*
  initializeDucts(network: Network) {
    network.register("codegen-type-constructor", () => {
      error("")
    })
  }
  */
}