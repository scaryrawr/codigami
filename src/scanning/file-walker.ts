import { readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import { CodigamiError } from "../types.ts";

export interface DiscoveredFile {
  relativePath: string;
  absolutePath: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git"]);

const isHidden = (name: string): boolean => name.startsWith(".");

export const walkDirectory = async (
  rootDir: string,
  extensions: string[],
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
          relativePath: relative(rootDir, absolutePath),
          absolutePath,
        });
      }
    }
  };

  await walk(rootDir);
  results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return results;
};
