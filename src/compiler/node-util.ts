import { opendir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { error } from './util.ts'

export async function foldDirectory<A>(dirPath: string,
	// [filePath, fileName, its text], then [dirPath, dirName, subfold result]
	f: (files: [string, string, string][], directories: [string, string, A][]) => A
): Promise<A> {
	let files: Promise<[string, string, string]>[] = []
	let directories: Promise<[string, string, A]>[] = []
	for await (let entry of await opendir(dirPath)) {
		let name = entry.name
		let path = join(dirPath, name)
		if (entry.isDirectory()) {
			directories.push(foldDirectory(path, f).then(x => [path, name, x]))
		} else if (entry.isFile() || entry.isSymbolicLink()) {
			files.push(readFile(path, "utf-8").then(text => [path, name, text]))
		} else
			error("unexpected type: " + path)
	}

	// recursive tasks are already spawned, does not matter which group is awaited first
	return f(await Promise.all(files), await Promise.all(directories))
}