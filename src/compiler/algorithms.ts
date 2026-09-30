import { every, indices, mkArray } from './util.ts'

export function* toposort<A>(
	vertices: A[], edges: (_: A) => number[]): Iterable<A> {
	let visited = mkArray(vertices.length, false)
	function* go(i: number): Iterable<A> {
		if (visited[i]) return
		visited[i] = true
		let v = vertices[i]
		for (let j of edges(v))
			yield* go(j)
		yield v
	}
	for (let i of indices(vertices))
		yield* go(i)
}

enum DfsColor {
	White,
	Grey,
	Black,
}
export let cycleDetected = Symbol("cycle-detected")
export function* toposortAcyclic<A>(
	vertices: A[],
	edges: (_: A) => number[],
	reportCycles: boolean = true
): Iterable<A | typeof cycleDetected> {
	let visited = mkArray(vertices.length, DfsColor.White)
	let intermediateColor = reportCycles ? DfsColor.Grey : DfsColor.Black
	function* go(i: number): Iterable<A | typeof cycleDetected> {
		if (visited[i] === DfsColor.Black) return
		if (visited[i] === DfsColor.Grey) {
			yield cycleDetected
			return
		}
		visited[i] = intermediateColor
		let v = vertices[i]
		for (let j of edges(v))
			yield* go(j)
		yield v
		visited[i] = DfsColor.Black
	}
	for (let i of indices(vertices))
		yield* go(i)
}

export function isAcyclic<A>(
	vertices: A[],
	edges: (_: A) => number[],
): boolean {
	return every(toposortAcyclic(vertices, edges), x => x !== cycleDetected)
}

/*
// Use BFS to compute longest non-looping distances in the graph
// then split vertices into groups of equal distance from source (levels)
// https://en.wikipedia.org/wiki/Level_structure
export function partitionByLevels<A>(
	vertices: A[],
	edges: (_: A) => number[]
): A[][] {

}
*/