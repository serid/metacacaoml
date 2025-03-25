import { mkArray, indices } from "./util.ts";

export function* toposort<A>(
	vertices: A[], edges: (_: A) => number[]): Iterable<A> {
	let visited = mkArray(vertices.length, false)
	function* go(i: number) {
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