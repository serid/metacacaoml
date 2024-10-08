import { assert } from './util.js'

export function spawn(f) {
  setTimeout(f)
}

export class Condition {
  constructor() {
    let f
    let r
    this.v = new Promise((f_, r_) => {
      f = f_
      r = r_
    })
    this.f = f
    this.r = r
    this.settled = false
  }

  fulfill(x) {
    this.settled = true
    this.f(x)
  }

  retract(x) {
    this.settled = true
    this.r(x)
  }

  then(a, b) {
    this.v.then(a, b)
  }
}

export class Mutex {
  constructor() {
    this.queue = []
  }

  async lock() {
    if (!this.locked) {
      this.locked = true
      return
    }
    let condition = new Condition()
    this.queue.push(condition)
    await condition
  }

  unlock() {
    assert(this.locked)
    if (this.queue.length === 0) {
      this.locked = false
      return
    }
    this.queue.shift().fulfill()
  }
}

// Single producer single consumer channel
export class Spsc {
  constructor() {
    this.readBarrier = new Condition()
    this.writeBarrier = new Condition()
  }

  async send(x) {
    assert(!this.readBarrier.settled)
    this.readBarrier.fulfill(x)
    await this.writeBarrier
    this.writeBarrier = new Condition()
  }

  async recv() {
    let x = await this.readBarrier
    // failing this assertion implies there were multiple concurrent reads
    assert(this.readBarrier.settled, "concurrent recv")
    this.readBarrier = new Condition()
    this.writeBarrier.fulfill()
    return x
  }
}

// Wraps an Spsc to allow unshifting values
export class Tunguska {
  constructor(ch) {
    this.v = ch
    this.stack = []
  }
  
  unshift(x) {
    this.stack.push(x)
  }
  
  async recv() {
    if (this.stack.length <= 0)
      return await this.v.recv()
    return this.stack.pop()
  }
  
  async peek() {
    if (this.stack.length <= 0)
      this.unshift(await this.v.recv())
    return this.stack[this.stack.length-1]
  }
}

export function tee(ch, f, g) {
  let ch1 = new Spsc()
  let ch2 = new Spsc()
  let a = f(ch1)
  let b = g(ch2)
  spawn(async () => { while (true) {
    let x = await ch.recv()
    await a.send(x)
    await b.send(x)
  }})
  return Promise.all([a, b])
}