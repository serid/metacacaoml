import { mangle } from './codegen.ts'
import { CompileError } from './compile.ts'
import { error, assert, assertL, fuel, range, last, makeFraction, every, unSingleton, assertDefined, assertEq, assertNonNull } from './util.ts'

function isPrefix(s: string, i: number, w: string) {
	if (w.length > s.length - i) return false
	for (let j = 0; j < w.length; j++)
		if (s[i + j] != w[j]) return false
	return true
}

function unsignalNaN(x: HyperReal, message: string) {
	if (x === signalingNan) error(message)
	return x
}

let identAnlautRule = /[a-zA-Z\-]/
let identInlautRule = /[a-zA-Z0-9\-/]/

// let infixOperatorAnlautRule =
//	/[\p{General_Category=Symbol}\p{General_Category=Punctuation}]/u
let infixOperatorInlautRule = /\S/
// let infixOperatorAuslautRule = infixOperatorAnlautRule

export const signalingNan = Symbol("signaling-NaN")
export type HyperReal = number | typeof signalingNan

export type InfixDecl = {
	symbols: string,
	associativity: string,
	strength: HyperReal,
	isMethod: boolean,
	replacement: string
}

export type Field = { name: string, type: TypeExpr }
export type Constructor = { name: string, fields: Field[] }

export type Annotation = { name: string, text: string }
export type Binding = { name: string, type: TypeExpr }

// A Toplevel is the syntactic part of an Item data structure
export namespace ToplevelTag {
	export const typeexpr = Symbol("type-expr")
	export const cls = Symbol("cls")
	export const _let = Symbol("let")
	export const fun = Symbol("fun")
	export const infixdecl = Symbol("infix-decl")
}

export type TypeExpr =
	{ tag: typeof ToplevelTag.typeexpr, span: number, arena: Instr[] }
export type Toplevel =
	| TypeExpr
	| { tag: typeof ToplevelTag.cls, span: number,
		name: string, gs: string[], conss: Constructor[] }
	| { tag: typeof ToplevelTag._let, span: number,
		name: string, retT: TypeExpr, arena: Instr[] }
	| { tag: typeof ToplevelTag.fun, span: number,
		isMethod: boolean, name: string, gs: string[], bs: Binding[],
		retT: TypeExpr, annots: Annotation[], arena: Instr[] }
	| { tag: typeof ToplevelTag.infixdecl, span: number } & InfixDecl

export namespace InstrTag {
	export const int = Symbol("int")
	export const strlit = Symbol("strlit")
	export const native = Symbol("native")
	export const use = Symbol("use")
	export const app = Symbol("app")
	export const endapp = Symbol("endapp")
	export const lam = Symbol("lam")
	export const array = Symbol("array")
	export const endarray = Symbol("endarray")

	export const any = Symbol("any")
	export const arrow = Symbol("arrow")
	export const endarrow = Symbol("endarrow")
}

export type Instr =
	| { tag: typeof InstrTag.int, span: number, data: number }
	| { tag: typeof InstrTag.strlit, span: number, data: string }
	| { tag: typeof InstrTag.native, span: number, code: string }
	| { tag: typeof InstrTag.use, span: number, name: string }
	| { tag: typeof InstrTag.app, span: number, metName: string | null }
	| { tag: typeof InstrTag.endapp, span: number }
	| { tag: typeof InstrTag.lam, span: number, ps: string[] }
	| { tag: typeof InstrTag.array, span: number }
	| { tag: typeof InstrTag.endarray, span: number }

	| { tag: typeof InstrTag.any, span: number }
	| { tag: typeof InstrTag.arrow, span: number }
	| { tag: typeof InstrTag.endarrow, span: number }

export class Syntax {
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
private ieee754(): HyperReal {
	if (this.tryWord("NaN") || this.tryWord("qNaN"))
		return NaN
	if (this.tryWord("sNaN"))
		return signalingNan

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
	return assertNonNull(this.ident(), "expected ident")
}

private stringLiteral(end: string) {
	let s = ""
	while (!this.tryWordNoWhitespace(end))
		s += this.char()
	this.tryWhitespace()
	return s
}

private type(): TypeExpr {
	return {tag: ToplevelTag.typeexpr,
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

private binding(): Binding | null {
	let name = this.ident()
	if (name === null) return null
	this.assertWord(":")
	let type = this.type()
	return { name, type }
}

private bindings(): Binding[] {
	let bs: Binding[] = []
	while (!this.tryWord(")")) {
		bs.push(assertNonNull(this.binding(), "expected a binding"))
	}
	return bs
}

private lambda(outInss: Instr[]) {
	// assumption: this.notPastEof() && "λ{".includes(this.peekChar())
	let span = this.i
	let isEmbraced = this.char() === "{"
	this.tryWhitespace()
	let ps = this.idents(".")
	outInss.push({tag: InstrTag.lam, span, ps})
	outInss.push(...this.expr())
	if (isEmbraced) this.assertWord("}")
}

private exprNoInfix(): Instr[] {
	let span = this.i
	let insQueue: Instr[] = []
	if (this.tryWord('"')) {
		insQueue.push({tag: InstrTag.strlit, span, data: this.stringLiteral('"')})
	} else if (this.tryWord("native[|")) {
		insQueue.push({tag: InstrTag.native, span, code: this.stringLiteral("|]")})
	} else if ("λ{".includes(this.peekChar())) {
		this.lambda(insQueue)
	} else if (/[0-9]/.test(this.peekChar())) {
		insQueue.push({tag: InstrTag.int, span, data: assertNonNull(this.uint())})
	} else if (this.tryWord("@[")) {
		insQueue.push({tag: InstrTag.array, span})
		span = this.i
		while (!this.tryWord("]")) {
			insQueue.push(...this.expr())
			span = this.i
		}
		insQueue.push({tag: InstrTag.endarray, span})
	} else if (this.tryWord("(")) {
		span = this.i
		let subexprs: Instr[][] = []
		while (!this.tryWord(")")) {
			subexprs.push(this.expr())
			span = this.i
		}

		// Elaborate (1) to 1
		// Elaborate (1 2 3) to Pair(1 Pair(2 3))
		for (let i of range(subexprs.length-1)) {
			insQueue.push({tag: InstrTag.app, span, metName:null})
			insQueue.push({tag: InstrTag.use, span,
				name:"PairᐅNew"})
			insQueue.push(...subexprs[i])
		}
		insQueue.push(...last(subexprs))
		for (let _ of range(subexprs.length-1))
			insQueue.push({tag: InstrTag.endapp, span})
	} else if (this.tryWord("@any")) {
		return [{tag: InstrTag.any, span}]
	} else if (this.tryWord("[")) {
		insQueue.push({tag: InstrTag.arrow, span})
		span = this.i
		while (!this.tryWord("]")) {
			insQueue.push(...this.expr())
			span = this.i
		}
		insQueue.push({tag: InstrTag.endarrow, span})
		insQueue.push(...this.expr())
		return insQueue
	} else {
		let name = assertNonNull(this.ident(), "expected expression")
		insQueue.push({tag: InstrTag.use, span, name})
	}

	while (true) {
	span = this.i

	// try parsing a function application, start with possible method name
	let metName = null
	if (this.tryWord(".")) {
		metName = this.assertIdent()
	}

	if (this.notPastEof() && "(λ{".includes(this.peekChar())) {
		insQueue.unshift({tag: InstrTag.app, span, metName})
		metName = null
		span = this.i
		if (this.tryWord("("))
			while (!this.tryWord(")")) {
				insQueue.push(...this.expr())
				span = this.i
			}

		// lambda arguments allowed after closing parenthesis
		while (this.notPastEof() && "λ{".includes(this.peekChar())) {
			this.lambda(insQueue)
			span = this.i
		}
		insQueue.push({tag: InstrTag.endapp, span})
		continue
	}

	assert(metName === null, "missing arguments after method name")
	break
	} // end postfix loop
	return insQueue
}

private static shuntingYardSpill(outputStack: Instr[][],
	operatorStack: {span:number, decl:InfixDecl}[]) {
	let op = assertDefined(operatorStack.pop())
	let right = assertDefined(outputStack.pop())
	let left = assertDefined(outputStack.pop())

	// arrange a function call around `left` in its buffer
	let inss = left
	if (op.decl.isMethod) {
		// blit "app+metName", [left], [right] and "endapp"
		inss.unshift({tag: InstrTag.app, span:op.span, metName:op.decl.replacement})
	} else {
		// blit "app", "use", [left], [right] and "endapp"
		inss.unshift({tag: InstrTag.app, span:op.span, metName:null},
			{tag: InstrTag.use, span:op.span, name:op.decl.replacement})
	}
	// left stays between app and right
	inss.push(...right)
	inss.push({tag: InstrTag.endapp, span:last(right).span})

	outputStack.push(inss)
}

// returns an array of instructions
private expr(): Instr[] {
	let first = this.exprNoInfix()

	// Try binary operators
	// Employ the shunting yard algorithm where output stack items are
	// fully baked instruction sequences
	let outputStack: Instr[][] = [first]
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
			let tosStrength = <number>tos.strength
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

private toplevel(): Toplevel {
	let annots: Annotation[] = []
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

		let conss: Constructor[] = []
		while (!this.tryWord("end")) {
			this.assertWord("|")
			let name = this.assertIdent()
			this.assertWord("(")

			let fields: Field[] = []
			let c = 0
			while (!this.tryWord(")")) {
				fields.push({
					name: "_" + c++,
					type: this.type()
				})
			}

			conss.push({name, fields})
		}

		return {tag: ToplevelTag.cls, span, name, gs, conss}
	} else if (this.tryWord("let")) {
		let name = this.assertIdent()
		this.assertWord(":")
		let retT = this.type()
		this.assertWord("=")

		return {tag: ToplevelTag._let, span, name, retT, arena: this.expr()}
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
		return {tag: ToplevelTag.fun, span, isMethod, name, gs, bs, retT, annots, arena}
	} else if (this.tryWord("infix")) {
		let associativity = "none"
		if (this.tryWord("left")) associativity = "left"
		if (this.tryWord("right")) associativity = "right"
		this.assertWord("at")
		let strength: HyperReal = this.ieee754()

		this.assertWord('"')
		let symbols = this.stringLiteral('"')
		this.assertWord("=")

		this.assertWord('"')
		let isMethod = this.tryWord(".")
		let replacement = this.stringLiteral('"')

		// assert(infixOperatorAnlautRule.test(firstStr(symbols)),
		// 	"an infix operator shall start with a symbol")
		assert(every(symbols, c => infixOperatorInlautRule.test(c)),
			"an infix operator shall contain no whitespace")
		// assert(infixOperatorAuslautRule.test(lastStr(symbols)),
		// 	"an infix operator shall end with a symbol")

		replacement = mangle(replacement)
		let infix: InfixDecl = {symbols, associativity, strength, isMethod, replacement}
		this.infixDecls.push(infix)

		return {tag: ToplevelTag.infixdecl, span, ...infix}
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