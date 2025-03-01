import { toString, write } from './util.ts'

import { Syntax } from "./syntax.ts"
import { Huk, RootTyck } from "./huk.ts"
import { ItemCodegen, RootCodegen } from "./codegen.ts"
import { Network } from './flow.ts'

const std = await globalThis.Deno.readTextFile("./memlstd.rs")

export class Compiler {
  src: string
  logging: boolean
  logs: string
  tyck: RootTyck
  itemTyck: Huk
  cg: RootCodegen
  itemCg: ItemCodegen
  itemNetwork: Network

  constructor(src: string, logging: boolean) {
    this.src = std + src
    this.logging = logging
    this.logs = ""
    this.tyck = new RootTyck(this)
    this.itemTyck = <Huk><unknown>null
    this.cg = new RootCodegen(this)
    this.itemCg = <ItemCodegen><unknown>null
    this.itemNetwork = new Network([
      "fun-name",
      "method-name-at",
      "codegen-item",
      "jit-compile",
    ])

    //this.tyck.initializeDucts(this.itemNetwork)
    //this.cg.initializeDucts(this.itemNetwork)
  }
  
  log(...xs: any[]) {
    write(...xs)
    for (let x of xs) this.logs += toString(x) + " "
    this.logs += "\n\n"
  }
  
  errorAt(span: number) {
    return ` at "${this.src.substring(span, span + 20)}"`
  }
  
  compile() {
    try {
      return this.analyze(new Syntax(this).syntax())
    } catch (e) {
      //console.log(this.logs)
      throw e
    }
  }
  
  analyze(items: Iterable<any>) {
    for (let item of items) {
      this.log("analyze", item)
      this.itemTyck = this.tyck.getItemTyck(item)
      this.itemCg = this.cg.getItemCodegen(item, [])
      this.itemTyck.tyck()
      this.cg.code += this.itemCg.codegen()
      
      this.itemNetwork.resetCache()
    }

    console.log(`normalizations count: ` + this.tyck.normalCounter)
    return this.cg.code
  }
}