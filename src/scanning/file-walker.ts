import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { CodigamiError } from "../types.ts";

export interface DiscoveredFile {
  relativePath: string;
  absolutePath: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const GIT_CHECK_IGNORE_BATCH_SIZE = 500;

const execFileAsync = promisify(execFile);

const isHidden = (name: string): boolean => name.startsWith(".");

const hasExactExitCode = (error: unknown, code: number): boolean => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === code;
};

const formatErrorDetails = (error: unknown): string => {
  if (typeof error !== "object" || error === null) {
    return String(error);
  }

  const details: string[] = [];
  if ("code" in error) details.push(`exitCode=${String(error.code)}`);
  if ("signal" in error && error.signal !== undefined) {
    details.push(`signal=${String(error.signal)}`);
  }
  if (error instanceof Error) details.push(error.message);

  return details.join("; ") || String(error);
};

const toGitRelativePath = (repositoryRoot: string, path: string): string =>
  relative(repositoryRoot, path).split(sep).join("/");

const createGitIgnoreChecker = async (
  rootDir: string,
): Promise<(paths: string[]) => Promise<Set<string>>> => {
  let repositoryRoot: string;

  try {
    const { stdout } = await execFileAsync("git", ["-C", rootDir, "rev-parse", "--show-toplevel"]);
    repositoryRoot = stdout.trim();
  } catch (error) {
    if (hasExactExitCode(error, 128)) {
      return async () => new Set();
    }

    throw new CodigamiError("Failed to locate git repository for gitignore evaluation", {
      rootDir,
      command: "git rev-parse --show-toplevel",
      cause: formatErrorDetails(error),
    });
  }

  const ignoredPaths = new Map<string, boolean>();

  return async (paths: string[]): Promise<Set<string>> => {
    const ignored = new Set<string>();
    const uncheckedPaths: string[] = [];
    const absolutePathMap = new Map<string, string>();

    for (const path of paths) {
      const relativePath = toGitRelativePath(repositoryRoot, path);
      const cached = ignoredPaths.get(relativePath);
      if (cached === true) {
        ignored.add(path);
      } else if (cached === undefined) {
        uncheckedPaths.push(relativePath);
        absolutePathMap.set(relativePath, path);
      }
    }

    if (uncheckedPaths.length === 0) return ignored;

    try {
      for (let i = 0; i < uncheckedPaths.length; i += GIT_CHECK_IGNORE_BATCH_SIZE) {
        const batch = uncheckedPaths.slice(i, i + GIT_CHECK_IGNORE_BATCH_SIZE);
        try {
          const { stdout } = await execFileAsync("git", [
            "-C",
            repositoryRoot,
            "check-ignore",
            "--",
            ...batch,
          ]);
          const ignoredRelativePaths = new Set(
            stdout.split("\n").filter((path) => path.length > 0),
          );

          for (const relativePath of batch) {
            const isIgnored = ignoredRelativePaths.has(relativePath);
            ignoredPaths.set(relativePath, isIgnored);
            if (isIgnored) {
              const absolutePath = absolutePathMap.get(relativePath);
              if (absolutePath !== undefined) ignored.add(absolutePath);
            }
          }
        } catch (error) {
          if (hasExactExitCode(error, 1)) {
            for (const relativePath of batch) {
              ignoredPaths.set(relativePath, false);
            }
            continue;
          }

          throw error;
        }
      }

      return ignored;
    } catch (error) {
      throw new CodigamiError("Failed to evaluate gitignore rules", {
        rootDir,
        command: "git check-ignore",
        cause: formatErrorDetails(error),
      });
    }
  };
};

export const commonDirectory = (paths: string[]): string => {
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
  const isGitIgnored = await createGitIgnoreChecker(rootDir);

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });

    const visibleEntries = entries.filter(
      (entry) => !isHidden(entry.name) && !SKIP_DIRS.has(entry.name),
    );
    const ignoredPaths = await isGitIgnored(visibleEntries.map((entry) => join(dir, entry.name)));

    for (const entry of visibleEntries) {
      const absolutePath = join(dir, entry.name);
      if (ignoredPaths.has(absolutePath)) continue;

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
  const [rootDir] = rootDirs;
  if (rootDir === undefined) {
    throw new CodigamiError("At least one directory is required");
  }

  if (rootDirs.length === 1) {
    return walkDirectory(rootDir, extensions);
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
