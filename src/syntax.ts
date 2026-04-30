import { mangle } from './codegen.ts'
import { CompileError } from './compile.ts'
import { error, assert, assertL, fuel, range, last, makeFraction, all, any, unSingleton, assertDefined, assertEq } from './util.ts'

function isPrefix(s: string, i: number, w: string) {
	if (w.length > s.length - i) return false
	for (let j = 0; j < w.length; j++)
		if (s[i + j] != w[j]) return false
	return true
}

function unsignalNaN(x: number | symbol, message: string) {
	assert(x !== Symbol.for("signaling-NaN"), message)
	return <number>x
}

type InfixDecl = {
	symbols: string,
	associativity: string,
	strength: number | symbol,
	isMethod: boolean,
	replacement: string
}

let identAnlautRule = /[a-zA-Z\-]/
let identInlautRule = /[a-zA-Z0-9\-/]/

// let infixOperatorAnlautRule =
//	/[\p{General_Category=Symbol}\p{General_Category=Punctuation}]/u
let infixOperatorInlautRule = /\S/
// let infixOperatorAuslautRule = infixOperatorAnlautRule

export class Syntax {
static strlit = Symbol("strlit")
static fun = Symbol("fun")
static native = Symbol("native")
static app = Symbol("app")
static endapp = Symbol("endapp")
static use = Symbol("use")
static applam = Symbol("applam")
static let = Symbol("let")
static arrow = Symbol("arrow")
static any = Symbol("any")
static endarrow = Symbol("endarrow")
static int = Symbol("int")
static nakedfun = Symbol("naked-fun")
static array = Symbol("array")
static endarray = Symbol("endarray")
static cls = Symbol("cls")
static infixdecl = Symbol("infix-decl")

private i: number = 0
private infixDecls: InfixDecl[] = []

constructor(private s: string) {}

private notPastEof() {
	return this.i < this.s.length
}

private checkInvariant() {
	assert(this.notPastEof(), "i out of bounds")
}

private peekWord(w: string) {
	return isPrefix(this.s, this.i, w)
}

private tryWordNoWhitespace(w: string) {
	if (!this.peekWord(w)) return false
	this.i += w.length
	return true
}

private tryWord(w: string) {
	let b = this.tryWordNoWhitespace(w)
	if (!b) return false
	this.tryWhitespace()
	return true
}

private assertWord(w: string) {
	assertL(this.tryWord(w), () => `expected "${w}"`)
}

private peekChar() {
	this.checkInvariant()
	return this.s[this.i]
}

private char() {
	this.checkInvariant()
	return this.s[this.i++]
}

private tryComment() {
	while (true) {
	if (this.tryWord("#{")) {
		while (this.notPastEof() && this.peekChar() !== '}') {
			if (this.peekChar() === '#')
				this.tryComment()
			else
				this.i++
		}
		this.i++
	} else if (this.tryWord("#")) {
		while (this.notPastEof() && this.peekChar() !== '\n') this.i++
		this.i++
	} else break
	}
}

private tryWhitespace() {
	while (this.notPastEof()) {
		this.tryComment()
		if (/\s/.test(this.peekChar())) {
			this.i++
			continue
		}
		break
	}
}

private uintNoWhiteSpace() {
	if (!/[0-9]/.test(this.peekChar())) return null
	let n = 0
	do {
		n *= 10
		n += parseInt(this.char())
	} while (this.notPastEof() && /[0-9]/.test(this.peekChar()))
	return n
}

private uint() {
	let n = this.uintNoWhiteSpace()
	this.tryWhitespace()
	return n
}

// parses a double-precision floating-point number
private ieee754() {
	if (this.tryWord("NaN") || this.tryWord("qNaN"))
		return NaN
	if (this.tryWord("sNaN"))
		return Symbol.for("signaling-NaN")

	let sign = this.tryWord("-") ? -1 : 1
	if (this.tryWord("∞"))
		return sign * Infinity
	let int = this.uintNoWhiteSpace() ?? 0
	this.assertWord(".")
	let fraction = this.uint() ?? 0
	return sign * (int + makeFraction(fraction))
}

private charactersWhile(r: RegExp): string {
	let s = ""
	while (this.notPastEof()) {
		let c = this.peekChar()
		if (!r.test(c)) break
		s += c
		this.i++
	}
	this.tryWhitespace()
	return s
}

private ident() {
	if (!this.notPastEof() ||
		!identAnlautRule.test(this.peekChar()))
		return null
	let id = this.charactersWhile(identInlautRule)
	return mangle(id)
}

private assertIdent() {
	let id = this.ident()
	assert(id !== null, "expected ident")
	return id
}

private stringLiteral(end: string) {
	let s = ""
	while (!this.tryWordNoWhitespace(end))
		s += this.char()
	this.tryWhitespace()
	return s
}

private type() {
	return {tag: Syntax.nakedfun,
		span: this.i,
		arena: this.expr()
	}
}

private idents(end: string) {
	let ns = []
	while (!this.tryWord(end))
		ns.push(this.assertIdent())
	return ns
}

private generics() {
	let gs = []
	while (this.tryWord("'")) {
		gs.push(this.assertIdent())
	}
	return gs
}

private binding() {
	let name = this.ident()
	if (name === null) return null
	this.assertWord(":")
	let type = this.type()
	return { name, type }
}

private bindings() {
	let bs = []
	while (!this.tryWord(")")) {
		fuel.step()
		bs.push(this.binding())
	}
	return bs
}

// returns an array of instructions
private exprNoInfix(): any[] {
	let span = this.i
	let insQueue = []
	if (this.tryWord('"')) {
		insQueue.push({tag: Syntax.strlit, span, data: this.stringLiteral('"')})
	} else if (this.tryWord("native[|")) {
		insQueue.push({tag: Syntax.native, span, code: this.stringLiteral("|]")})
	// } else if ("λ{".includes(this.peekChar())) {
	// 	let isEmbraced = this.char() === "{"
	// 	this.tryWhitespace()
	// 	let ps = this.idents(".")
	// 	insQueue.push({tag: Syntax.lam, span, ps, body: this.expr()})
	// 	if (isEmbraced) this.assertWord("}")
	// 	return insQueue
	} else if (/[0-9]/.test(this.peekChar())) {
		insQueue.push({tag: Syntax.int, span, data: this.uint()})
	} else if (this.tryWord("@[")) {
		insQueue.push({tag:Syntax.array, span})
		span = this.i
		while (!this.tryWord("]")) {
			insQueue.push(...this.expr())
			span = this.i
		}
		insQueue.push({tag:Syntax.endarray, span})
	} else if (this.tryWord("(")) {
		span = this.i
		let subexprs = []
		while (!this.tryWord(")")) {
			subexprs.push(this.expr())
			span = this.i
		}

		// Elaborate (1) to 1
		// Elaborate (1 2 3) to Pair(1 Pair(2 3))
		for (let i of range(subexprs.length-1)) {
			insQueue.push({tag:Syntax.app, span, metName:null})
			insQueue.push({tag:Syntax.use, span,
				name:"PairᐅNew"})
			insQueue.push(...subexprs[i])
		}
		insQueue.push(...last(subexprs))
		for (let _ of range(subexprs.length-1))
			insQueue.push({tag:Syntax.endapp,
				span})
	} else if (this.tryWord("@any")) {
		return [{tag:Syntax.any, span}]
	} else if (this.tryWord("[")) {
		insQueue.push({tag:Syntax.arrow, span})
		span = this.i
		while (!this.tryWord("]")) {
			insQueue.push(...this.expr())
			span = this.i
		}
		insQueue.push({tag:Syntax.endarrow, span})
		insQueue.push(...this.expr())
		return insQueue
	} else {
		let name = this.ident()
		assert(name !== null, "expected expression")
		insQueue.push({tag: Syntax.use, span, name})
	}

	while (true) {
	span = this.i

	let metName = null
	if (this.tryWord(".")) {
		metName = this.assertIdent()
	}

	// try parsing a function application
	// lambdas don't need round parentheses ()
	if (this.notPastEof() && "(λ{".includes(this.peekChar())) {
		insQueue.unshift({tag: Syntax.app, span, metName})
		metName = null
		span = this.i
		if (this.tryWord("("))
			while (!this.tryWord(")")) {
				insQueue.push(...this.expr())
				span = this.i
			}
		while (this.notPastEof() && "λ{".includes(this.peekChar())) {
			let span2 = this.i
			let isEmbraced = this.char() === "{"
			this.tryWhitespace()
			let ps = this.idents(".")
			insQueue.push({tag: Syntax.applam, span: span2, ps})
			insQueue.push(...this.expr())
			if (isEmbraced) this.assertWord("}")
			span = this.i
		}
		insQueue.push({tag: Syntax.endapp, span})
		continue
	}

	assert(metName === null, "missing arguments after method name")
	break
	} // end postfix loop
	return insQueue
}

private static shuntingYardSpill(outputStack: any[][],
	operatorStack: {span:number, decl:InfixDecl}[]) {
	let op = assertDefined(operatorStack.pop())
	let right = assertDefined(outputStack.pop())
	let left = assertDefined(outputStack.pop())

	// arrange a function call around `left` in its buffer
	let inss = left
	if (op.decl.isMethod) {
		// blit "app+metName", [left], [right] and "endapp"
		inss.unshift({tag:Syntax.app, span:op.span, metName:op.decl.replacement})
	} else {
		// blit "app", "use", [left], [right] and "endapp"
		inss.unshift({tag:Syntax.app, span:op.span, metName:null},
			{tag:Syntax.use, span:op.span, name:op.decl.replacement})
	}
	//left stays between app and right
	inss.push(...right)
	inss.push({tag:Syntax.endapp, span:last(right).span})

	outputStack.push(inss)
}

// returns an array of instructions
private expr(): any[] {
	let first = this.exprNoInfix()

	// Try binary operators
	// Employ the shunting yard algorithm where output stack items are
	// fully baked instruction sequences
	let outputStack: any[][] = [first]
	let operatorStack: {span:number, decl:InfixDecl}[] = []
	while (true) {
		let span = this.i
		let decl = this.infixDecls.find(
			infixDecl => this.tryWord(infixDecl.symbols))
		if (decl === undefined) break

		let strength = unsignalNaN(decl.strength, "operator precedence was NaN")

		// If new operator has lower precedence then operator TOS,
		// spill stack to output
		while (operatorStack.length > 0) {
			let tos = last(operatorStack).decl
			let tosStrength = any(tos.strength)
			if (tosStrength < strength) break

			// Handle associativity
			if (tosStrength === strength) {
				// todo: there are 9 possible combinations of associativity
				// figure out how to resolve them
				assertEq(tos.associativity, decl.associativity)
				if (tos.associativity === "none")
					error("both infix operators are non-associative")
				if (tos.associativity === "right") break
				// left associative operators proceed to spilling
			}

			Syntax.shuntingYardSpill(outputStack, operatorStack)
		}

		operatorStack.push({span, decl})

		outputStack.push(this.exprNoInfix())
	}

	// Spill remnants
	while (operatorStack.length > 0)
		Syntax.shuntingYardSpill(outputStack, operatorStack)

	return unSingleton(outputStack)
}

private toplevel() {
	let annots = []
	if (this.tryWord("@")) {
		let name = this.assertIdent()
		this.assertWord('(')
		let text = this.stringLiteral(')')
		annots.push({name, text})
	}

	let span = this.i
	if (this.tryWord("class")) {
		let name = this.assertIdent()
		let gs = this.generics()

		let conss = []
		while (!this.tryWord("end")) {
			this.assertWord("|")
			let name = this.assertIdent()
			this.assertWord("(")

			let fields = []
			let c = 0
			while (!this.tryWord(")")) {
				fields.push({
					name: "_" + c++,
					type: this.type()
				})
			}

			conss.push({name, fields})
		}

		return {tag: Syntax.cls, span, name, gs, conss}
	} else if (this.tryWord("let")) {
		let name = this.assertIdent()
		this.assertWord(":")
		let retT = this.type()
		this.assertWord("=")

		return {tag: Syntax.let, span, name, retT, arena: this.expr()}
	} else if (this.tryWord("fun")) {
		let isMethod = this.tryWord(".")
		let name = this.assertIdent()
		this.assertWord("(")
		let gs = this.generics()
		let bs = this.bindings()
		this.assertWord(":")
		let retT = this.type()
		this.assertWord("=")

		let arena = this.expr()
		return {tag: Syntax.fun, span, isMethod,name, gs, bs, retT, annots, arena}
	} else if (this.tryWord("infix")) {
		let associativity = "none"
		if (this.tryWord("left")) associativity = "left"
		if (this.tryWord("right")) associativity = "right"
		this.assertWord("at")
		let strength = this.ieee754()

		this.assertWord('"')
		let symbols = this.stringLiteral('"')
		this.assertWord("=")

		this.assertWord('"')
		let isMethod = this.tryWord(".")
		let replacement = this.stringLiteral('"')

		// assert(infixOperatorAnlautRule.test(firstStr(symbols)),
		// 	"an infix operator shall start with a symbol")
		assert(all(symbols, c => infixOperatorInlautRule.test(c)),
			"an infix operator shall contain no whitespace")
		// assert(infixOperatorAuslautRule.test(lastStr(symbols)),
		// 	"an infix operator shall end with a symbol")

		replacement = mangle(replacement)
		let infix = {symbols, associativity, strength, isMethod, replacement}
		this.infixDecls.push(infix)

		return {tag: Syntax.infixdecl, span, ...infix}
	}
	else
		error("expected toplevel")
}

*syntax() {
	try {
	this.tryWhitespace()
	while (this.notPastEof()) {
		fuel.step()
		yield this.toplevel()
	}
	} catch (e) {
		throw new CompileError(this.i, undefined, undefined, { cause: e })
	}
}
}