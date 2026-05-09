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
  cacheKey?: string;
}

export const hashContent = (content: string, cacheKey?: string): string => {
  const hash = createHash("sha256");

  if (cacheKey !== undefined && cacheKey.length > 0) {
    hash.update("codigami-file-hash-v2");
    hash.update("\0");
    hash.update(cacheKey);
    hash.update("\0");
  }

  hash.update(content);
  return hash.digest("hex");
};

export const detectFileChanges = async (
  input: DetectFileChangesInput,
): Promise<FileChangeResult> => {
  const { files, hashStore, readFile, cacheKey } = input;
  const storedHashes = hashStore.getHashes();
  const discoveredPaths = new Set<string>();
  const changed: DiscoveredFile[] = [];

  for (const file of files) {
    discoveredPaths.add(file.relativePath);
    const content = await readFile(file.absolutePath);
    const currentHash = hashContent(content, cacheKey);
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
