function singleUse(f) {
  let flag = false
  return x => {
    if (flag) throw new Error("can only be called once")
    flag = true
    f(x)
  }
}

function *control0/*<A, B>*/(handler)/*: Generator<(B -> A) -> Generator, A, A>*/ {
    return yield handler
}

function *prompt/*<A, B>*/(comp/*: (...) -> Generator<(B -> A) -> Generator, A, B>*/, ...args)/*: Generator<(B -> A) -> Generator, A, B>*/ {
    // instantiate gen inside prompt to ensure exclusive ownership
    let gen = comp(...args)
    let { value, done } = gen.next()
    if (done)
        return value
    // control0 emitted a handler
    let handler = value
    return yield* handler(x => singleUse(gen.next(x)))
}

// example function
function *bar() {}
function *foo() {
    // call an effectful function, pass effects upwards, but print result
    //desugared from: let res = yield* bar()
    //because yield* obscures errors as
    //"(immediate value)(immediate value) is not iterable"

    //can also be generalized to ingest values as in
    //https://chatgpt.com/share/67b646fb-c198-800e-939b-fa4f67853128
    let g = bar()
    let res
    while (true) {
      let pair = g.next()
      if (pair.done) {
        res = pair.value
        break
      }
      yield pair.value
    }
    console.log(res)
}