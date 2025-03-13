// Pull-style query system for compilers

import { join, mapGet, ObjectMap, write } from "./util.ts"

function argsToString(args: string[]) {
  return args.join(":")
}

export class ItemNetwork {
  paths: string[]
  //ducts: ObjectMap<(..._: string[]) => any>
  cache: ObjectMap<ObjectMap<any>>

  constructor(paths: string[]) {
    this.paths = paths
    //this.ducts = Object.create(null)
    this.cache = Object.create(null)
    this.resetCache()
  }

  memoize<A>(path: string, args: string[], duct: (..._: string[]) => A): A {
    // note: this reactivity style requires `duct` closure
    // to be allocated on every call, in contrast to `register` style

    // write(`> ${path}(${join(args)})`)
    let column = mapGet(this.cache, path)
    let key = argsToString(args)
    let value = column[key]
    if (value !== undefined) return value
    
    value = duct(...args)
    column[key] = value
    return value
  }

  /*
  register(path: string, duct: (..._: string[]) => any) {
    mapInsert(this.ducts, path, duct)
  }

  exec(path: string, ...args: string[]): any {
    write(`> ${path}(${join(args)})`)
    let column = mapGet(this.cache, path)
    let key = argsToString(args)
    let value = column[key]
    if (value !== undefined) return value
    
    value = mapGet(this.ducts, path)(...args)
    column[key] = value
    return value
  }
  */
  
  resetCache() {
    for (let path of this.paths) this.cache[path] = Object.create(null)
  }
}