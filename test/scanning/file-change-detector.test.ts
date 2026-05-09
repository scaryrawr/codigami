import { describe, expect, it, vi } from "vitest";
import type { FileHashStore } from "../../src/types.ts";
import { detectFileChanges } from "../../src/scanning/file-change-detector.ts";
import type { DiscoveredFile } from "../../src/scanning/file-walker.ts";

const makeFile = (relativePath: string): DiscoveredFile => ({
  relativePath,
  absolutePath: `/abs/${relativePath}`,
});

const createMockHashStore = (initial: Map<string, string> = new Map()): FileHashStore => {
  const hashes = new Map(initial);
  return {
    getHashes: vi.fn(() => new Map(hashes)),
    setHash: vi.fn((path: string, hash: string) => hashes.set(path, hash)),
    removeFiles: vi.fn((paths: string[]) => {
      for (const p of paths) hashes.delete(p);
    }),
    close: vi.fn(),
  };
};

describe("detectFileChanges", () => {
  it("marks all files as changed when no prior hashes exist", async () => {
    const files = [makeFile("a.ts"), makeFile("b.ts")];
    const hashStore = createMockHashStore();
    const readFile = vi.fn(async () => "content");

    const result = await detectFileChanges({ files, hashStore, readFile });

    expect(result.changed).toEqual(files);
    expect(result.deleted).toEqual([]);
  });

  it("skips unchanged files", async () => {
    const files = [makeFile("a.ts"), makeFile("b.ts")];
    const readFile = vi.fn(async (path: string) =>
      path.includes("a.ts") ? "content-a" : "content-b",
    );

    // Pre-compute the hash for a.ts content
    const crypto = await import("node:crypto");
    const hashA = crypto.createHash("sha256").update("content-a").digest("hex");

    const hashStore = createMockHashStore(new Map([["a.ts", hashA]]));

    const result = await detectFileChanges({ files, hashStore, readFile });

    expect(result.changed.map((f) => f.relativePath)).toEqual(["b.ts"]);
    expect(result.deleted).toEqual([]);
  });

  it("detects changed files by content hash mismatch", async () => {
    const files = [makeFile("a.ts")];
    const hashStore = createMockHashStore(new Map([["a.ts", "stale-hash"]]));
    const readFile = vi.fn(async () => "new content");

    const result = await detectFileChanges({ files, hashStore, readFile });

    expect(result.changed.map((f) => f.relativePath)).toEqual(["a.ts"]);
  });

  it("detects deleted files", async () => {
    const files = [makeFile("a.ts")];
    const hashStore = createMockHashStore(
      new Map([
        ["a.ts", "hash-a"],
        ["deleted.ts", "hash-deleted"],
        ["also-gone.ts", "hash-gone"],
      ]),
    );

    const crypto = await import("node:crypto");
    const hashA = crypto.createHash("sha256").update("content-a").digest("hex");
    hashStore.getHashes = vi.fn(
      () =>
        new Map([
          ["a.ts", hashA],
          ["deleted.ts", "hash-deleted"],
          ["also-gone.ts", "hash-gone"],
        ]),
    );

    const readFile = vi.fn(async () => "content-a");

    const result = await detectFileChanges({ files, hashStore, readFile });

    expect(result.deleted.sort()).toEqual(["also-gone.ts", "deleted.ts"]);
  });

  it("returns empty results for empty file list with no prior hashes", async () => {
    const hashStore = createMockHashStore();
    const readFile = vi.fn(async () => "");

    const result = await detectFileChanges({ files: [], hashStore, readFile });

    expect(result.changed).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it("returns deleted files when file list is empty but hashes exist", async () => {
    const hashStore = createMockHashStore(new Map([["old.ts", "hash"]]));
    const readFile = vi.fn(async () => "");

    const result = await detectFileChanges({ files: [], hashStore, readFile });

    expect(result.changed).toEqual([]);
    expect(result.deleted).toEqual(["old.ts"]);
  });
});
