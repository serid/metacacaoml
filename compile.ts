import { assert, range, toString, write } from './util.ts'

import { Syntax } from "./syntax.ts"
import { Huk, RootTyck } from "./huk.ts"
import { ItemCodegen, RootCodegen } from "./codegen.ts"
import { Network } from './flow.ts'

const std = await globalThis.Deno.readTextFile("./memlstd.rs")

export class CompileError extends Error {
  log: string
  span: number

  constructor(span: number, log?: string, message?: string,
    options?: ErrorOptions) {
    super(message, options)
    this.log = log ?? ""
    this.span = span
  }
}

export class Compiler {
  src: string
  logging: boolean
  logs: string[]
  tyck: RootTyck
  itemTyck: Huk
  cg: RootCodegen
  itemCg: ItemCodegen
  itemNetwork: Network

  constructor(src: string, logging: boolean) {
    this.src = std + src
    this.logging = logging
    this.logs = []
    this.tyck = new RootTyck(this)
    this.itemTyck = <Huk><unknown>null
    this.cg = new RootCodegen(this)
    this.itemCg = <ItemCodegen><unknown>null
    this.itemNetwork = new Network([
      "codegen-item",
    ])

    //this.tyck.initializeDucts(this.itemNetwork)
    //this.cg.initializeDucts(this.itemNetwork)
  }
  
  log(...xs: any[]) {
    write(...xs)
    for (let x of xs) this.logs.push(toString(x), " ")
    this.logs.push("\n\n")
  }

  reportError(e: CompileError) {
    this.log(e.log)

    let lineNumber = 0
    for (let i of range(e.span)) if (this.src[i] === "\n") lineNumber++
    let lineNumberString = lineNumber + " | "

    // line begins after either line feed or -1
    let lineStart = this.src.lastIndexOf("\n", e.span) + 1
    let lineEnd = this.src.indexOf("\n", e.span)
    if (lineEnd === -1) lineEnd = this.src.length
    this.log(lineNumberString + this.src.substring(lineStart, lineEnd))
    this.log(" ".repeat(lineNumberString.length + (e.span - lineStart)) + "^")
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
    try {
      for (let item of items) {
        this.itemTyck = this.tyck.getItemTyck(item)
        this.itemCg = this.cg.getItemCodegen(item)
        this.itemTyck.tyck()
        this.itemCg.step()
      
        this.itemNetwork.resetCache()
      }
  
      console.log(`normalizations count: ` + this.tyck.normalCounter)
      return this.cg.getCode()
    } catch (e) {
      if (e.constructor !== CompileError) throw e
      // this.log("analyze", item)
      this.reportError(e)
      assert(e.cause!==undefined, "expected cause")
      throw e.cause
    }
  }
}