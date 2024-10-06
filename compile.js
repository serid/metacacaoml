import { assert, write, step, Pakulikha } from './util.js';

import { Syntax } from "./syntax.js"
import { Huk } from "./huk.js"
import { Codegen } from "./codegen.js"

let std = await (await fetch("./memlstd.js")).text()

export class Compiler {
  constructor(src) {
    src = std + src
    this.src = src
    this.tyck = new Huk(this)
    this.cg = new Codegen(this)
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
      this.tyck.setItem(item)
      this.tyck.tyck()
      this.cg.setItem(item)
      this.cg.codegen()
    }
  
    return this.cg.code
  }
}