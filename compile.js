import { assert, toString, write, step, Pakulikha } from './util.js';

import { Syntax } from "./syntax.js"
import { RootTyck } from "./huk.js"
import { RootCodegen } from "./codegen.js"

let std = await (await fetch("./memlstd.js")).text()

export class Compiler {
  constructor(src, logging) {
    this.src = std + src
    this.logging = logging
    this.logs = ""
    this.tyck = new RootTyck(this)
    this.itemTyck = null
    this.cg = new RootCodegen(this, [])
  }
  
  log(...xs) {
    xs.forEach(x=>{
      this.logs += toString(x) + " "
    })
    this.logs += "\n\n"
  }
  
  errorAt(span) {
    return ` at "${this.src.substring(span, span + 20)}"`
  }
  
  compile() {
    try {
      return this.analyze(new Syntax(this).syntax())
    } catch (e) {
      console.log(this.logs)
      throw e
    }
  }
  
  analyze(items) {
    for (let item of items) {
      this.log("analyze", item)
      this.itemTyck = this.tyck.getItemTyck(item)
      this.itemTyck.tyck()
      this.cg.getItemCodegen(item).codegen()
    }

    console.log(`normalizations count: ` + this.tyck.normalCounter)
    return this.cg.code
  }
}