import { assert, write, step, Pakulikha } from './util.js';

import { Syntax } from "./syntax.js"
import { RootTyck } from "./huk.js"
import { RootCodegen } from "./codegen.js"

let std = await (await fetch("./memlstd.js")).text()

export class Compiler {
  constructor(src) {
    src = std + src
    this.src = src
    this.tyck = new RootTyck(this)
    this.itemTyck = null
    this.cg = new RootCodegen(this)
  }
  
  errorAt(span) {
    return ` at "${this.src.substring(span, span + 20)}"`
  }
  
  compile() {
    return this.analyze(new Syntax(this).syntax())
  }
  
  analyze(items) {
    for (let item of items) {
      write("analyze", item)
      this.itemTyck = this.tyck.getItemTyck(item)
      this.itemTyck.tyck()
      this.cg.getItemCodegen(item).codegen()
    }
  
    return this.cg.code
  }
}