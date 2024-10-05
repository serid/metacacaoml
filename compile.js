import { assert, write, step, Pakulikha } from './util.js';

import { Syntax } from "./syntax.js"
import { Huk } from "./huk.js"
import { Codegen } from "./codegen.js"

let std = await (await fetch("./memlstd.js")).text()

class Analysis {
  constructor(compiler) {
    this.compiler = compiler
  }
  
  analyze(ss) {
    let a = new Pakulikha()
    let b = new Pakulikha()
    let tyck = new Huk(this.compiler, a).tyck()
    let cg = new Codegen(this.compiler, b).codegen()
    step(tyck)
    step(cg)
    
    let code
    for (let i of ss) {
      //write("analyze", i)
      a.send(i); b.send(i)
      tyck.next()
      code = cg.next().value
    }
    
    assert(code !== undefined)
    return code
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