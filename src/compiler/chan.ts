import { assert } from './util.ts'

export function spawn(f: () => void): void {
	setTimeout(f)
}

export class Condition<A> {
	v: Promise<A>
	f: (_: A) => void
	r: (_: any) => void
	settled: boolean

	constructor() {
		let f: any
		let r: any
		this.v = new Promise((f_, r_) => {
			f = f_
			r = r_
		})
		this.f = f
		this.r = r
		this.settled = false
	}

	fulfill(x: A): void {
		this.settled = true
		this.f(x)
	}

	retract(x: any): void {
		this.settled = true
		this.r(x)
	}

	then(a: (_: A) => any, b: (_: any) => any): Promise<any> {
		return this.v.then(a, b)
	}
}

export class Mutex {
	queue: Condition<void>[]
	locked: boolean

	constructor() {
		this.queue = []
		this.locked = false
	}

	async lock(): Promise<void> {
		if (!this.locked) {
			this.locked = true
			return
		}
		let condition = new Condition<void>()
		this.queue.push(condition)
		await condition
	}

	unlock(): void {
		assert(this.locked)
		if (this.queue.length === 0) {
			this.locked = false
			return
		}
		this.queue.shift()!.fulfill()
	}
}

// Single producer single consumer channel
export class Spsc<A> {
	readBarrier: Condition<A>
	writeBarrier: Condition<void>

	constructor() {
		this.readBarrier = new Condition()
		this.writeBarrier = new Condition()
	}

	async send(x: A): Promise<void> {
		assert(!this.readBarrier.settled)
		this.readBarrier.fulfill(x)
		await this.writeBarrier
		this.writeBarrier = new Condition()
	}

	async recv(): Promise<A> {
		let x = await this.readBarrier
		// failing this assertion implies there were multiple concurrent reads
		assert(this.readBarrier.settled, "concurrent recv")
		this.readBarrier = new Condition()
		this.writeBarrier.fulfill()
		return x
	}
}

// Wraps an Spsc to allow unshifting values
export class Tunguska<A> {
	v: Spsc<A>
	stack: A[]

	constructor(ch: Spsc<A>) {
		this.v = ch
		this.stack = []
	}

	unshift(x: A): void {
		this.stack.push(x)
	}

	async recv(): Promise<A> {
		if (this.stack.length <= 0)
			return await this.v.recv()
		return this.stack.pop()!
	}

	async peek(): Promise<A> {
		if (this.stack.length <= 0)
			this.unshift(await this.v.recv())
		return this.stack[this.stack.length-1]
	}
}