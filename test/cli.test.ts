import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { main } from "../src/cli.ts";

const mocks = (() => {
  const databaseInstances: MockDatabase[] = [];
  class MockDatabase {
    readonly path: string;
    close = vi.fn(() => {});

    constructor(path: string) {
      this.path = path;
      databaseInstances.push(this);
    }
  }

  const hashStores: Array<{
    getHashes: ReturnType<typeof vi.fn<() => Map<string, string>>>;
    setHash: ReturnType<typeof vi.fn<(filePath: string, hash: string) => void>>;
    removeFiles: ReturnType<typeof vi.fn<(filePaths: string[]) => void>>;
    close: ReturnType<typeof vi.fn<() => void>>;
  }> = [];
  const indexStores: Array<{
    upsertUnits: ReturnType<typeof vi.fn>;
    storeEmbeddings: ReturnType<typeof vi.fn>;
    replaceFileUnitsWithEmbeddings: ReturnType<typeof vi.fn>;
    getAllWithEmbeddings: ReturnType<typeof vi.fn<() => []>>;
    deleteByFilePaths: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn<() => void>>;
  }> = [];

  const createHashStore = () => {
    const hashStore = {
      getHashes: vi.fn(() => new Map<string, string>()),
      setHash: vi.fn(),
      removeFiles: vi.fn(),
      close: vi.fn(),
    };
    hashStores.push(hashStore);
    return hashStore;
  };

  return {
    MockDatabase,
    hashStores,
    indexStores,
    databaseInstances,
    mkdir: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    parserInit: vi.fn(async () => {}),
    commonDirectory: vi.fn((paths: string[]) => paths[0] ?? "."),
    walkDirectories: vi.fn(async () => []),
    createDefaultLanguageParser: vi.fn(async () => ({
      language: "multi",
      extensions: [".ts", ".rs", ".py"],
      parse: vi.fn(),
    })),
    createOpenAIEmbeddingProvider: vi.fn(() => ({ embed: vi.fn() })),
    openSqliteDatabase: vi.fn((dbPath: string) => new MockDatabase(dbPath)),
    createSqliteStoreFromDatabase: vi.fn(() => {
      const store = {
        upsertUnits: vi.fn(),
        storeEmbeddings: vi.fn(),
        replaceFileUnitsWithEmbeddings: vi.fn(),
        getAllWithEmbeddings: vi.fn(() => []),
        deleteByFilePaths: vi.fn(),
        clear: vi.fn(),
        close: vi.fn(),
      };
      indexStores.push(store);
      return store;
    }),
    createSqliteHashStore: vi.fn(createHashStore),
    runPipeline: vi.fn(async () => ({
      scannedFiles: 0,
      totalUnits: 0,
      duplicateClusters: [],
      threshold: 0.8,
      timestamp: "2026-05-08T00:00:00.000Z",
    })),
  };
})();

const createDependencies = () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  initParser: mocks.parserInit,
  commonDirectory: mocks.commonDirectory,
  walkDirectories: mocks.walkDirectories,
  createDefaultLanguageParser: mocks.createDefaultLanguageParser,
  createOpenAIEmbeddingProvider: mocks.createOpenAIEmbeddingProvider,
  openSqliteDatabase: mocks.openSqliteDatabase,
  createSqliteStoreFromDatabase: mocks.createSqliteStoreFromDatabase,
  createSqliteHashStore: mocks.createSqliteHashStore,
  runPipeline: mocks.runPipeline,
});

describe("main", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    mocks.databaseInstances.length = 0;
    mocks.hashStores.length = 0;
    mocks.indexStores.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("rejects an invalid threshold before scanning or opening stores", async () => {
    await main(["--threshold", "abc"], createDependencies());

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Error: threshold must be a number between 0.0 and 1.0, got: "abc"',
    );
    expect(mocks.parserInit).not.toHaveBeenCalled();
    expect(mocks.createSqliteStoreFromDatabase).not.toHaveBeenCalled();
    expect(mocks.databaseInstances).toHaveLength(0);
  });

  it.each(["-0.1", "1.1"])("rejects out-of-range threshold %s", async (threshold) => {
    await main([`--threshold=${threshold}`], createDependencies());

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      `Error: threshold must be a number between 0.0 and 1.0, got: "${threshold}"`,
    );
    expect(mocks.runPipeline).not.toHaveBeenCalled();
  });

  it("rejects invalid comparison levels before scanning or opening stores", async () => {
    await main(["--level", "package"], createDependencies());

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Error: level must include one or more of: function, class, file; got: ["package"]',
    );
    expect(mocks.parserInit).not.toHaveBeenCalled();
    expect(mocks.createSqliteStoreFromDatabase).not.toHaveBeenCalled();
    expect(mocks.databaseInstances).toHaveLength(0);
  });

  it("uses one shared Bun sqlite connection for the index and hash stores", async () => {
    await main(["--threshold", "0.75"], createDependencies());

    expect(process.exitCode).toBe(0);
    expect(mocks.databaseInstances).toHaveLength(1);
    expect(mocks.openSqliteDatabase).toHaveBeenCalledWith(expect.stringContaining("index.db"));
    expect(mocks.createSqliteStoreFromDatabase).toHaveBeenCalledWith(mocks.databaseInstances[0]);
    expect(mocks.createSqliteHashStore).toHaveBeenCalledWith(mocks.databaseInstances[0]);
    expect(mocks.walkDirectories).toHaveBeenCalledWith([expect.any(String)], [".ts", ".rs", ".py"]);
    expect(mocks.runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        store: mocks.indexStores[0],
        threshold: 0.75,
        comparisonLevels: ["function"],
        hashStore: mocks.hashStores[0],
      }),
    );
    expect(mocks.indexStores[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.hashStores[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.databaseInstances[0].close).toHaveBeenCalledTimes(1);
  });

  it("accepts repeated directory arguments and scans them together", async () => {
    await main(["--dir", "packages/a", "--dir", "packages/b"], createDependencies());

    expect(process.exitCode).toBe(0);
    expect(mocks.walkDirectories).toHaveBeenCalledWith(
      [expect.stringContaining("packages/a"), expect.stringContaining("packages/b")],
      [".ts", ".rs", ".py"],
    );
    expect(mocks.runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [],
      }),
    );
  });

  it("passes repeated and comma-separated comparison levels to the pipeline", async () => {
    await main(["--level", "function,class", "--level", "file"], createDependencies());

    expect(process.exitCode).toBe(0);
    expect(mocks.runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        comparisonLevels: ["function", "class", "file"],
      }),
    );
  });
});
