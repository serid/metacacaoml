import { write } from './util.js';

import { spawn, Spsc, Tunguska } from './chan.js';

import { Syntax } from "./syntax.js"
import { Huk } from "./huk.js"
import { Codegen } from "./codegen.js"

class Analysis {
  constructor(compiler) {
    this.compiler = compiler
  }
  
  async analyze(ss) {
    let a = new Spsc()
    let b = new Spsc()
    let tyck = new Huk(this.compiler, new Tunguska(a)).tyck()
    let cg = new Codegen(this.compiler, new Tunguska(b)).codegen()
    spawn(async () => { for (let i of ss) {
      write("analyze", i)
      await a.send(i)
      await b.send(i)
    }})
    let [_, code] = await Promise.all([tyck, cg])
    return code
  }
}

export class Compiler {
  constructor(src) {
    this.src = src
  }
  
  errorAt(span) {
    return ` at "${this.src.substring(span, span + 7)}"`
  }
  
  async compile() {
    return await new Analysis(this).analyze(new Syntax(this).syntax())
  }
}