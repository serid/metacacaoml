import { assertEq, nonExhaustiveMatch, join, ObjectSet, setContains, last, mapInsert } from './util.ts'

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
  code: {name:string, code:string[]}[]
  
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

  push(s: string) {
    last(this.code).code.push(s)
  }

  emitSsa(e: string) {
    let ix = this.alloc()
    this.push(`  const ${ix} = ${e}\n`)
    return ix
  }

emitYieldStar(what: string): string {
  let yieldReturnVar = this.alloc()
  this.push(`  let ${yieldReturnVar}; while (true) { let pair = ${what}.next(); if (pair.done) { ${yieldReturnVar} = pair.value; break } yield pair.value }\n`)
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
      "_fixtures_."+name : name
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
      "_fixtures_."+this.c.itemTyck.getMethodNameAt(insLocation) :
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
    
    this.push(`  function*(${join(ins.ps)}) {\n`)
    let retIx = this.expr()
    this.push(`  return ${retIx}\n  },\n`)
    }
    
    this.push("  );\n")
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
    if (e.constructor === CompileError) throw e
    throw new CompileError(this.ins().span, undefined, undefined, { cause: e })
  }
}

// list of key-value pairs to add to the global object
codegenUncached(): {name:string, code:string}[] {
  try {
  let item = this.item

  //write("cg", ins)
  switch (item.tag) {
  case Syntax.cls:
    let elimCode = []
    let ps = join(item.conss.map(x=>x.name))
    elimCode.push(`function*(self, ${ps}) {\n  switch (self.tag) {\n`)
    for (let c of item.conss) {
      let ps = c.fields.map(x=>x.name)
      let bs = join(ps)
      this.code.push({name:item.name+"ᐅ"+c.name, code:[
        `function*(${bs}) {\n`,
        `  return {tag: Symbol.for("${c.name}"), ${bs}}\n}\n`
      ]})
      let as = join(ps.map(x=>"self."+x))
      //todo: eliminate yield*
      elimCode.push(`  case Symbol.for("${c.name}"): `)
      elimCode.push(`return yield* ${c.name}(${as});\n`)
    }
    elimCode.push(`  default: throw new Error("nonexhaustive: " + self.tag.description)\n`)
    elimCode.push("  }\n}\n")
    this.code.push({name:item.name+"ᐅelim", code:elimCode})
    break
  case Syntax.let:
    this.code.push({name:item.name, code:[`(function*() {\n`]})
    let retIx = this.expr()
    this.push(`  return ${retIx}\n})().next().value`)
    break
  case Syntax.fun:
    let bs = item.bs.map(x=>x.name)
    this.code.push({name:this.c.itemTyck.funName, code:[`(function*(${join(bs)}) {\n`]})
    let retIx2 = this.expr()
    
    this.push(`  return ${retIx2}\n})`)
    break
  case Syntax.nakedfun:
    this.code.push({name:"_", code:[]})
    this.push(`  return ${this.expr()}`)
    break
  default:
    nonExhaustiveMatch(item.tag)
  }
  } catch (e) {
    if (e.constructor === CompileError) throw e
    throw new CompileError(this.item.span, undefined, undefined, { cause: e })
  }
  let out: {name:string, code:any}[] = this.code
  for (let pair of out) pair.code = pair.code.join("")
  return out
}

codegen(): {name:string, code:string}[] {
  return this.c.itemNetwork.memoize(
    "codegen-item", [], this.codegenUncached.bind(this))
}

step() {
  let cgs = this.codegen()
  let aToplevel = cgs.flatMap(
    ({name, code}) => ["_fixtures_.", name, " = ", code, "\n"]).join("")
  this.root.code.push(aToplevel)
  
  for (let {name} of cgs)
    mapInsert(this.fixtureNames, name, null)
}
}

export class RootCodegen {
  c: any
  code: string[]
  fixtureNames: ObjectSet
  
  constructor(c: any) {
    this.c = c // compiler
    this.code = [
      `"use strict";\n`,
      `const _fixtures_ = Object.create(null)\n`
    ]
    this.fixtureNames = Object.create(null)
  }
  
  getItemCodegen(item: any, fixtureNames: ObjectSet = this.fixtureNames) {
    return new ItemCodegen(this, item, fixtureNames)
  }

  getCode(): string {
    this.code.push("_fixtures_.main().next()")
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