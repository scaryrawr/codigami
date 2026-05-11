import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  CodigamiError,
  type CodeUnit,
  type EmbeddingProvider,
  type FileHashStore,
  type IndexStore,
  type LanguageParser,
} from "../src/types.ts";
import {
  createComparisonLevelsCacheKey,
  runPipeline,
  type PipelineProgress,
} from "../src/pipeline.ts";
import { hashContent } from "../src/scanning/file-change-detector.ts";
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
  const functionLevelCacheKey = createComparisonLevelsCacheKey(["function"]);

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
      replaceFileUnitsWithEmbeddings: vi.fn(
        (
          _filePaths: string[],
          units: CodeUnit[],
          entries: { unitId: string; embedding: number[] }[],
        ) => {
          storedUnits.push(...units);
          storedEmbeddings.push(...entries);
        },
      ),
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

    expect(mockStore.replaceFileUnitsWithEmbeddings).toHaveBeenCalled();
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

  it("filters parsed units to function level by default", async () => {
    const classUnit: CodeUnit = {
      ...unitA,
      id: "class1",
      unitType: "class_declaration",
      name: "Worker",
      source: "class Worker { run() {} }",
    };
    mockParser.parse = vi.fn(async () => [classUnit, unitA]);

    await runPipeline({
      files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
    });

    expect(storedUnits.map((unit) => unit.unitType)).toEqual(["function_declaration"]);
  });

  it("includes class-level units when requested", async () => {
    const classUnit: CodeUnit = {
      ...unitA,
      id: "class1",
      unitType: "class_declaration",
      name: "Worker",
      source: "class Worker { run() {} }",
    };
    mockParser.parse = vi.fn(async () => [classUnit, unitA]);

    await runPipeline({
      files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
      comparisonLevels: ["function", "class"],
    });

    expect(storedUnits.map((unit) => unit.unitType)).toEqual([
      "class_declaration",
      "function_declaration",
    ]);
  });

  it("adds whole-file units when file level is requested", async () => {
    const source = "const value = 1;\nconst other = 2;";
    mockParser.parse = vi.fn(async () => []);

    await runPipeline({
      files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
      parser: mockParser,
      embeddingProvider: mockEmbeddingProvider,
      store: mockStore,
      threshold: 0.8,
      readFile: createMockFileReader(new Map([["/abs/test.ts", source]])),
      comparisonLevels: ["file"],
    });

    expect(storedUnits).toHaveLength(1);
    expect(storedUnits[0]).toMatchObject({
      filePath: "test.ts",
      startLine: 1,
      endLine: 2,
      unitType: "file",
      name: "test.ts",
      source,
      language: "typescript",
    });
    expect(mockEmbeddingProvider.embed).toHaveBeenCalledWith([source]);
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
    expect(mockEmbeddingProvider.embed).toHaveBeenNthCalledWith(1, [
      units[0].source,
      units[1].source,
    ]);
    expect(mockEmbeddingProvider.embed).toHaveBeenNthCalledWith(2, [
      units[2].source,
      units[3].source,
    ]);
    expect(mockEmbeddingProvider.embed).toHaveBeenNthCalledWith(3, [units[4].source]);
  });

  it("streams across multiple files without holding all units in memory", async () => {
    const fileAUnits = [
      makeUnit("a1", "fa", "function fa() {}"),
      makeUnit("a2", "fb", "function fb() {}"),
    ];
    const fileBUnits = [
      makeUnit("b1", "fc", "function fc() {}"),
      makeUnit("b2", "fd", "function fd() {}"),
    ];

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

  it("does not persist units when the embedding provider fails", async () => {
    const providerFailure = new Error("embedding endpoint unavailable");
    mockEmbeddingProvider.embed = vi.fn(async () => {
      throw providerFailure;
    });

    await expect(
      runPipeline({
        files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
        parser: mockParser,
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        readFile: createMockFileReader(new Map([["/abs/test.ts", "source"]])),
      }),
    ).rejects.toThrow(CodigamiError);

    expect(mockStore.upsertUnits).not.toHaveBeenCalled();
    expect(mockStore.storeEmbeddings).not.toHaveBeenCalled();
    expect(mockStore.replaceFileUnitsWithEmbeddings).not.toHaveBeenCalled();
  });

  it("does not persist units when embedding count validation fails", async () => {
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
    ).rejects.toThrow(CodigamiError);

    expect(mockStore.upsertUnits).not.toHaveBeenCalled();
    expect(mockStore.storeEmbeddings).not.toHaveBeenCalled();
    expect(mockStore.replaceFileUnitsWithEmbeddings).not.toHaveBeenCalled();
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

    const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

    it("skips unchanged files", async () => {
      const fileContent = "source code";
      const hashStore = createMockHashStore(
        new Map([["test.ts", hashContent(fileContent, functionLevelCacheKey)]]),
      );

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

    it("reprocesses unchanged content when the parser cache key changes", async () => {
      const content = "source code";
      const rawContentHash = sha256(content);
      const parserWithCacheKey: LanguageParser = {
        ...mockParser,
        cacheKey: "parser-rules-v2",
        parse: vi.fn(async () => [unitA, unitB, unitC]),
      };
      const hashStore = createMockHashStore(new Map([["test.ts", rawContentHash]]));

      await runPipeline({
        files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
        parser: parserWithCacheKey,
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        hashStore,
        readFile: createMockFileReader(new Map([["/abs/test.ts", content]])),
      });

      expect(parserWithCacheKey.parse).toHaveBeenCalledTimes(1);
      expect(hashStore.setHash).toHaveBeenCalledWith(
        "test.ts",
        hashContent(content, `parser-rules-v2|${functionLevelCacheKey}`),
      );

      vi.clearAllMocks();

      await runPipeline({
        files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
        parser: parserWithCacheKey,
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        hashStore,
        readFile: createMockFileReader(new Map([["/abs/test.ts", content]])),
      });

      expect(parserWithCacheKey.parse).not.toHaveBeenCalled();
      expect(mockEmbeddingProvider.embed).not.toHaveBeenCalled();
    });

    it("reprocesses unchanged content when comparison levels change", async () => {
      const content = "source code";
      const hashStore = createMockHashStore(
        new Map([["test.ts", hashContent(content, functionLevelCacheKey)]]),
      );

      await runPipeline({
        files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
        parser: mockParser,
        embeddingProvider: mockEmbeddingProvider,
        store: mockStore,
        threshold: 0.8,
        hashStore,
        readFile: createMockFileReader(new Map([["/abs/test.ts", content]])),
        comparisonLevels: ["function", "class"],
      });

      expect(mockParser.parse).toHaveBeenCalledTimes(1);
      expect(hashStore.setHash).toHaveBeenCalledWith(
        "test.ts",
        hashContent(content, createComparisonLevelsCacheKey(["function", "class"])),
      );
    });

    it("prunes deleted files from store and hash store", async () => {
      const hashStore = createMockHashStore(
        new Map([
          ["existing.ts", hashContent("content", functionLevelCacheKey)],
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
      const hashStore = createMockHashStore(
        new Map([["a.ts", hashContent(content, functionLevelCacheKey)]]),
      );
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
        readFile: createMockFileReader(
          new Map([
            ["/abs/a.ts", content],
            ["/abs/b.ts", "other"],
          ]),
        ),
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

      expect(hashStore.setHash).toHaveBeenCalledWith(
        "test.ts",
        hashContent(content, functionLevelCacheKey),
      );
    });

    it("does not mark a changed file processed or delete stale units when embedding fails", async () => {
      const hashStore = createMockHashStore(new Map([["test.ts", "old-hash"]]));
      mockEmbeddingProvider.embed = vi.fn(async () => {
        throw new Error("embedding endpoint unavailable");
      });

      await expect(
        runPipeline({
          files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
          parser: mockParser,
          embeddingProvider: mockEmbeddingProvider,
          store: mockStore,
          threshold: 0.8,
          hashStore,
          readFile: createMockFileReader(new Map([["/abs/test.ts", "updated content"]])),
        }),
      ).rejects.toThrow(CodigamiError);

      expect(mockStore.deleteByFilePaths).not.toHaveBeenCalledWith(["test.ts"]);
      expect(mockStore.upsertUnits).not.toHaveBeenCalled();
      expect(mockStore.storeEmbeddings).not.toHaveBeenCalled();
      expect(mockStore.replaceFileUnitsWithEmbeddings).not.toHaveBeenCalled();
      expect(hashStore.setHash).not.toHaveBeenCalled();
    });

    it("does not mark a changed file processed or delete stale units when embedding count validation fails", async () => {
      const hashStore = createMockHashStore(new Map([["test.ts", "old-hash"]]));
      mockEmbeddingProvider.embed = vi.fn(async () => [[1, 0, 0]]);

      await expect(
        runPipeline({
          files: [{ relativePath: "test.ts", absolutePath: "/abs/test.ts" }],
          parser: mockParser,
          embeddingProvider: mockEmbeddingProvider,
          store: mockStore,
          threshold: 0.8,
          hashStore,
          readFile: createMockFileReader(new Map([["/abs/test.ts", "updated content"]])),
        }),
      ).rejects.toThrow(CodigamiError);

      expect(mockStore.deleteByFilePaths).not.toHaveBeenCalledWith(["test.ts"]);
      expect(mockStore.upsertUnits).not.toHaveBeenCalled();
      expect(mockStore.storeEmbeddings).not.toHaveBeenCalled();
      expect(mockStore.replaceFileUnitsWithEmbeddings).not.toHaveBeenCalled();
      expect(hashStore.setHash).not.toHaveBeenCalled();
    });

    it("deletes stale units for changed files after embeddings are ready", async () => {
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

      expect(mockStore.replaceFileUnitsWithEmbeddings).toHaveBeenCalledWith(
        ["test.ts"],
        [unitA, unitB, unitC],
        [
          { unitId: unitA.id, embedding: [1, 0, 0] },
          { unitId: unitB.id, embedding: [1, 0, 0] },
          { unitId: unitC.id, embedding: [1, 0, 0] },
        ],
      );
      expect(hashStore.setHash).toHaveBeenCalledWith(
        "test.ts",
        hashContent("updated content", functionLevelCacheKey),
      );
    });
  });
});
