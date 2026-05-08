import { createHash } from "node:crypto";
import type { FileHashStore } from "../types.ts";
import type { DiscoveredFile } from "./file-walker.ts";

export interface FileChangeResult {
	changed: DiscoveredFile[];
	deleted: string[];
}

export interface DetectFileChangesInput {
	files: DiscoveredFile[];
	hashStore: FileHashStore;
	readFile: (path: string) => Promise<string>;
}

export const hashContent = (content: string): string => {
	return createHash("sha256").update(content).digest("hex");
};

export const detectFileChanges = async (input: DetectFileChangesInput): Promise<FileChangeResult> => {
	const { files, hashStore, readFile } = input;
	const storedHashes = hashStore.getHashes();
	const discoveredPaths = new Set<string>();
	const changed: DiscoveredFile[] = [];

	for (const file of files) {
		discoveredPaths.add(file.relativePath);
		const content = await readFile(file.absolutePath);
		const currentHash = hashContent(content);
		const storedHash = storedHashes.get(file.relativePath);

		if (storedHash !== currentHash) {
			changed.push(file);
		}
	}

	const deleted: string[] = [];
	for (const storedPath of storedHashes.keys()) {
		if (!discoveredPaths.has(storedPath)) {
			deleted.push(storedPath);
		}
	}

	return { changed, deleted };
};
