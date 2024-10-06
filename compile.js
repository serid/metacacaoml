import { assert, write, step, Pakulikha } from './util.js';

import { Syntax } from "./syntax.js"
import { Huk } from "./huk.js"
import { Codegen } from "./codegen.js"

let std = await (await fetch("./memlstd.js")).text()

class Analysis {
  constructor(compiler) {
    this.compiler = compiler
  }
  
  analyze(items) {
    let tyck = new Huk(this.compiler)
    let cg = new Codegen(this.compiler)
    
    for (let item of items) {
      write("analyze", item)
      tyck.setItem(item)
      tyck.tyck()
      cg.setItem(item)
      cg.codegen()
    }
    
    return cg.code
  }
}

export class Compiler {
  constructor(src) {
    src = std + src
    this.src = src
  }
  
  errorAt(span) {
    return ` at "${this.src.substring(span, span + 20)}"`
  }
  
  compile() {
    return new Analysis(this).analyze(new Syntax(this).syntax())
  }
}