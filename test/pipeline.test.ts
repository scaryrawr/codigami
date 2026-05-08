import { describe, expect, it, vi, beforeEach } from "vitest";

import { CodigamiError, type CodeUnit, type EmbeddingProvider, type FileHashStore, type IndexStore, type LanguageParser } from "../src/types.ts";
import { runPipeline, type PipelineProgress } from "../src/pipeline.ts";
import { createHash } from "node:crypto";

const makeUnit = (id: string, name: string, source: string): CodeUnit => ({
  id,
  filePath: "test.ts",
  startLine: 1,
  endLine: 5,
  unitType: "function_declaration",
  name,
  source,
  language: "typescript",
});

const createMockFileReader = (files: Map<string, string>) => {
  return async (path: string): Promise<string> => {
    const content = files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  };
};

describe("runPipeline", () => {
  const unitA = makeUnit("a1", "foo", "function foo() {}");
  const unitB = makeUnit("b1", "bar", "function bar() {}");
  const unitC = makeUnit("c1", "baz", "function baz() {}");

  let mockParser: LanguageParser;
  let mockEmbeddingProvider: EmbeddingProvider;
  let storedUnits: CodeUnit[];
  let storedEmbeddings: { unitId: string; embedding: number[] }[];
  let mockStore: IndexStore;

  beforeEach(() => {
    storedUnits = [];
    storedEmbeddings = [];

    mockParser = {
      language: "typescript",
      extensions: [".ts", ".js"],
      parse: vi.fn(async (_filePath: string, _source: string) => [unitA, unitB, unitC]),
    };

    mockEmbeddingProvider = {
      embed: vi.fn(async (texts: string[]) => {
        return texts.map(() => [1, 0, 0]);
      }),
    };

    mockStore = {
      upsertUnits: vi.fn((units: CodeUnit[]) => {
        storedUnits.push(...units);
      }),
      storeEmbeddings: vi.fn((entries: { unitId: string; embedding: number[] }[]) => {
        storedEmbeddings.push(...entries);
      }),
      getAllWithEmbeddings: vi.fn(() => [
        { unit: unitA, embedding: [1, 0, 0] },
        { unit: unitB, embedding: [1, 0, 0] },
        { unit: unitC, embedding: [0, 1, 0] },
      ]),
      deleteByFilePaths: vi.fn(),
      clear: vi.fn(),
      close: vi.fn(),
    };
  });

  it("produces a duplicate report", async () => {
    const report = await runPipeline({
      files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
    });

    expect(report.scannedFiles).toBe(1);
    expect(report.totalUnits).toBe(3);
    expect(report.threshold).toBe(0.8);
    expect(report.timestamp).toBeTruthy();
  });

  it("stores units and embeddings in the index", async () => {
    await runPipeline({
      files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
    });

    expect(mockStore.upsertUnits).toHaveBeenCalled();
    expect(mockStore.storeEmbeddings).toHaveBeenCalled();
    expect(storedUnits.length).toBe(3);
    expect(storedEmbeddings.length).toBe(3);
  });

  it("finds duplicates above threshold", async () => {
    const report = await runPipeline({
      files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
    });

    // unitA and unitB have identical embeddings [1,0,0], unitC is [0,1,0]
    expect(report.duplicateClusters.length).toBe(1);
    expect(report.duplicateClusters[0].units.length).toBe(2);
  });

  it("returns empty clusters when nothing is similar", async () => {
    mockStore.getAllWithEmbeddings = vi.fn(() => [
      { unit: unitA, embedding: [1, 0, 0] },
      { unit: unitB, embedding: [0, 1, 0] },
      { unit: unitC, embedding: [0, 0, 1] },
    ]);

    const report = await runPipeline({
      files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
    });

    expect(report.duplicateClusters.length).toBe(0);
  });

  it("handles multiple files", async () => {
    const fileContents = new Map([
      ["/abs/a.ts", "source a"],
      ["/abs/b.ts", "source b"],
    ]);

    const report = await runPipeline({
      files: [
        { relativePath: "a.ts", absolutePath: "/abs/a.ts" },
        { relativePath: "b.ts", absolutePath: "/abs/b.ts" },
      ],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(fileContents),
    });

    expect(report.scannedFiles).toBe(2);
  });

  it("handles files with no extractable units", async () => {
    mockParser.parse = vi.fn(async () => []);
    mockStore.getAllWithEmbeddings = vi.fn(() => []);

    const report = await runPipeline({
      files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(new Map([["/abs/test.ts", "// empty"]])),
    });

    expect(report.totalUnits).toBe(0);
    expect(report.duplicateClusters.length).toBe(0);
  });

  it("batches embedding calls", async () => {
    await runPipeline({
      files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
    });

    // 3 units with batch size 64 = 1 embed call
    expect(mockEmbeddingProvider.embed).toHaveBeenCalledTimes(1);
  });

  it("flushes in exact batch-size chunks when units exceed batch size", async () => {
    const units = Array.from({ length: 5 }, (_, i) =>
      makeUnit(`u${i}`, `fn${i}`, `function fn${i}() {}`),
    );
    mockParser.parse = vi.fn(async () => units);
    mockStore.getAllWithEmbeddings = vi.fn(() =>
      units.map((u) => ({ unit: u, embedding: [1, 0, 0] })),
    );

    await runPipeline({
      files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
      embeddingBatchSize: 2,
    });

    // 5 units with batch size 2 = 3 embed calls (2, 2, 1)
    expect(mockEmbeddingProvider.embed).toHaveBeenCalledTimes(3);
    expect(mockEmbeddingProvider.embed).toHaveBeenNthCalledWith(1, [units[0].source, units[1].source]);
    expect(mockEmbeddingProvider.embed).toHaveBeenNthCalledWith(2, [units[2].source, units[3].source]);
    expect(mockEmbeddingProvider.embed).toHaveBeenNthCalledWith(3, [units[4].source]);
  });

  it("streams across multiple files without holding all units in memory", async () => {
    const fileAUnits = [makeUnit("a1", "fa", "function fa() {}"), makeUnit("a2", "fb", "function fb() {}")];
    const fileBUnits = [makeUnit("b1", "fc", "function fc() {}"), makeUnit("b2", "fd", "function fd() {}")];

    let callCount = 0;
    mockParser.parse = vi.fn(async (_path: string) => {
      callCount++;
      return callCount === 1 ? fileAUnits : fileBUnits;
    });
    mockStore.getAllWithEmbeddings = vi.fn(() =>
      [...fileAUnits, ...fileBUnits].map((u) => ({ unit: u, embedding: [1, 0, 0] })),
    );

    const fileContents = new Map([
      ["/abs/a.ts", "source a"],
      ["/abs/b.ts", "source b"],
    ]);

    await runPipeline({
      files: [
        { relativePath: "a.ts", absolutePath: "/abs/a.ts" },
        { relativePath: "b.ts", absolutePath: "/abs/b.ts" },
      ],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(fileContents),
      embeddingBatchSize: 3,
    });

    // 4 units total, batch size 3 → batch of 3 after file B parsed, then remainder 1
    expect(mockEmbeddingProvider.embed).toHaveBeenCalledTimes(2);
  });

  it("invokes onProgress callback with expected events", async () => {
    const events: PipelineProgress[] = [];

    await runPipeline({
      files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
      onProgress: (p) => events.push(p),
    });

    expect(events.some((e) => e.stage === "parsing")).toBe(true);
    expect(events.some((e) => e.stage === "embedding")).toBe(true);
    expect(events.some((e) => e.stage === "matching")).toBe(true);

    const parsingEvent = events.find((e) => e.stage === "parsing")!;
    expect(parsingEvent).toMatchObject({ current: 1, total: 1, path: "test.ts" });
  });

  it("throws on invalid embeddingBatchSize", async () => {
    await expect(
      runPipeline({
        files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
        parser: mockParser,
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
        embeddingBatchSize: 0,
      }),
    ).rejects.toThrow(CodigamiError);
  });

  it("throws on invalid parseConcurrency", async () => {
    await expect(
      runPipeline({
        files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
        parser: mockParser,
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
        parseConcurrency: 0,
      }),
    ).rejects.toThrow(CodigamiError);
  });

  it("parses multiple files concurrently with parseConcurrency", async () => {
    const fileAUnits = [makeUnit("a1", "fa", "function fa() {}")];
    const fileBUnits = [makeUnit("b1", "fb", "function fb() {}")];
    const fileCUnits = [makeUnit("c1", "fc", "function fc() {}")];

    let callCount = 0;
    mockParser.parse = vi.fn(async (_path: string) => {
      callCount++;
      if (callCount === 1) return fileAUnits;
      if (callCount === 2) return fileBUnits;
      return fileCUnits;
    });
    mockStore.getAllWithEmbeddings = vi.fn(() =>
      [...fileAUnits, ...fileBUnits, ...fileCUnits].map((u) => ({ unit: u, embedding: [1, 0, 0] })),
    );

    const fileContents = new Map([
      ["/abs/a.ts", "source a"],
      ["/abs/b.ts", "source b"],
      ["/abs/c.ts", "source c"],
    ]);

    const report = await runPipeline({
      files: [
        { relativePath: "a.ts", absolutePath: "/abs/a.ts" },
        { relativePath: "b.ts", absolutePath: "/abs/b.ts" },
        { relativePath: "c.ts", absolutePath: "/abs/c.ts" },
      ],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(fileContents),
      parseConcurrency: 3,
    });

    expect(report.scannedFiles).toBe(3);
    expect(report.totalUnits).toBe(3);
    expect(mockParser.parse).toHaveBeenCalledTimes(3);
  });

  it("throws when embedding provider returns wrong vector count", async () => {
    mockEmbeddingProvider.embed = vi.fn(async () => [[1, 0, 0]]);

    await expect(
      runPipeline({
        files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
        parser: mockParser,
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
      }),
    ).rejects.toThrow("unexpected vector count");
  });

  describe("incremental processing with hashStore", () => {
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

    const sha256 = (content: string): string =>
      createHash("sha256").update(content).digest("hex");

    it("skips unchanged files", async () => {
      const fileContent = "source code";
      const hashStore = createMockHashStore(new Map([["test.ts", sha256(fileContent)]]));

      await runPipeline({
        files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
        parser: mockParser,
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        hashStore,
        readFile: createMockFileReader(new Map([["/abs/test.ts", fileContent]])),
      });

      // Parser should NOT have been called — file was skipped
      expect(mockParser.parse).not.toHaveBeenCalled();
      expect(mockEmbeddingProvider.embed).not.toHaveBeenCalled();
    });

    it("processes changed files", async () => {
      const hashStore = createMockHashStore(new Map([["test.ts", "stale-hash"]]));

      await runPipeline({
        files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
        parser: mockParser,
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        hashStore,
        readFile: createMockFileReader(new Map([["/abs/test.ts", "new content"]])),
      });

      expect(mockParser.parse).toHaveBeenCalled();
      expect(mockEmbeddingProvider.embed).toHaveBeenCalled();
    });

    it("prunes deleted files from store and hash store", async () => {
      const hashStore = createMockHashStore(
        new Map([
          ["existing.ts", sha256("content")],
          ["deleted.ts", "old-hash"],
        ]),
      );

      mockStore.getAllWithEmbeddings = vi.fn(() => []);

      await runPipeline({
        files: [{ relativePath: "existing.ts", absolutePath: "/abs/existing.ts" }],
        parser: { ...mockParser, parse: vi.fn(async () => []) },
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        hashStore,
        readFile: createMockFileReader(new Map([["/abs/existing.ts", "content"]])),
      });

      expect(mockStore.deleteByFilePaths).toHaveBeenCalledWith(["deleted.ts"]);
      expect(hashStore.removeFiles).toHaveBeenCalledWith(["deleted.ts"]);
    });

    it("emits skipped progress event", async () => {
      const content = "source";
      const hashStore = createMockHashStore(new Map([["a.ts", sha256(content)]]));
      const events: PipelineProgress[] = [];

      mockStore.getAllWithEmbeddings = vi.fn(() => []);

      await runPipeline({
        files: [
          { relativePath: "a.ts", absolutePath: "/abs/a.ts" },
          { relativePath: "b.ts", absolutePath: "/abs/b.ts" },
        ],
        parser: { ...mockParser, parse: vi.fn(async () => []) },
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        hashStore,
        readFile: createMockFileReader(new Map([["/abs/a.ts", content], ["/abs/b.ts", "other"]])),
        onProgress: (p) => events.push(p),
      });

      const skipped = events.find((e) => e.stage === "skipped");
      expect(skipped).toBeDefined();
      expect(skipped).toMatchObject({ stage: "skipped", count: 1, total: 2 });
    });

    it("updates hash store after processing a file", async () => {
      const hashStore = createMockHashStore();
      const content = "new file content";

      mockStore.getAllWithEmbeddings = vi.fn(() =>
        [unitA, unitB, unitC].map((u) => ({ unit: u, embedding: [1, 0, 0] })),
      );

      await runPipeline({
        files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
        parser: mockParser,
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        hashStore,
        readFile: createMockFileReader(new Map([["/abs/test.ts", content]])),
      });

      expect(hashStore.setHash).toHaveBeenCalledWith("test.ts", sha256(content));
    });

    it("deletes stale units for changed files before re-indexing", async () => {
      const hashStore = createMockHashStore(new Map([["test.ts", "old-hash"]]));

      await runPipeline({
        files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
        parser: mockParser,
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        hashStore,
        readFile: createMockFileReader(new Map([["/abs/test.ts", "updated content"]])),
      });

      // Should delete old units for the changed file before re-processing
      expect(mockStore.deleteByFilePaths).toHaveBeenCalledWith(["test.ts"]);
    });
  });
});
