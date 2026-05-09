import { readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import { CodigamiError } from "../types.ts";

export interface DiscoveredFile {
  relativePath: string;
  absolutePath: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git"]);

const isHidden = (name: string): boolean => name.startsWith(".");

const commonDirectory = (paths: string[]): string => {
  const [firstPath, ...rest] = paths;
  if (firstPath === undefined) {
    throw new CodigamiError("At least one directory is required");
  }

  const commonParts = firstPath.split(sep);
  for (const path of rest) {
    const parts = path.split(sep);
    let idx = 0;
    while (idx < commonParts.length && idx < parts.length && commonParts[idx] === parts[idx]) {
      idx++;
    }
    commonParts.length = idx;
  }

  return commonParts.join(sep) || sep;
};

const walkDirectoryFromBase = async (
  rootDir: string,
  extensions: string[],
  relativeBase: string,
): Promise<DiscoveredFile[]> => {
  try {
    await stat(rootDir);
  } catch {
    throw new CodigamiError(`Directory does not exist: ${rootDir}`, {
      rootDir,
    });
  }

  const extSet = new Set(extensions);
  const results: DiscoveredFile[] = [];

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (isHidden(entry.name)) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const absolutePath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && extSet.has(extname(entry.name))) {
        results.push({
          relativePath: relative(relativeBase, absolutePath),
          absolutePath,
        });
      }
    }
  };

  await walk(rootDir);
  return results;
};

export const walkDirectory = async (
  rootDir: string,
  extensions: string[],
): Promise<DiscoveredFile[]> => {
  const results = await walkDirectoryFromBase(rootDir, extensions, rootDir);
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
};

export const walkDirectories = async (
  rootDirs: string[],
  extensions: string[],
): Promise<DiscoveredFile[]> => {
  if (rootDirs.length === 0) {
    throw new CodigamiError("At least one directory is required");
  }

  if (rootDirs.length === 1) {
    return walkDirectory(rootDirs[0]!, extensions);
  }

  const resolvedRootDirs = rootDirs.map((rootDir) => resolve(rootDir));
  const relativeBase = commonDirectory(resolvedRootDirs);
  const filesByAbsolutePath = new Map<string, DiscoveredFile>();

  for (const rootDir of resolvedRootDirs) {
    const files = await walkDirectoryFromBase(rootDir, extensions, relativeBase);
    for (const file of files) {
      filesByAbsolutePath.set(file.absolutePath, file);
    }
  }

  const results = [...filesByAbsolutePath.values()];
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
};
