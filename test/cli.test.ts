import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.ts";

const mocks = vi.hoisted(() => {
  class MockDatabase {
    static instances: MockDatabase[] = [];

    readonly path: string;
    open = true;
    close = vi.fn(() => {
      this.open = false;
    });

    constructor(path: string) {
      this.path = path;
      MockDatabase.instances.push(this);
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
    mkdir: vi.fn(async () => {}),
    writeFile: vi.fn(async () => {}),
    parserInit: vi.fn(async () => {}),
    walkDirectory: vi.fn(async () => []),
    createTypescriptParser: vi.fn(async () => ({
      language: "typescript",
      extensions: [".ts"],
      parse: vi.fn(),
    })),
    createOpenAIEmbeddingProvider: vi.fn(() => ({ embed: vi.fn() })),
    createSqliteStoreFromDatabase: vi.fn(() => {
      const store = {
        upsertUnits: vi.fn(),
        storeEmbeddings: vi.fn(),
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
});

vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
}));

vi.mock("web-tree-sitter", () => ({
  Parser: { init: mocks.parserInit },
}));

vi.mock("better-sqlite3", () => ({
  default: mocks.MockDatabase,
}));

vi.mock("../src/scanning/file-walker.ts", () => ({
  walkDirectory: mocks.walkDirectory,
}));

vi.mock("../src/scanning/typescript-parser.ts", () => ({
  createTypescriptParser: mocks.createTypescriptParser,
}));

vi.mock("../src/embedding/openai-embedding-provider.ts", () => ({
  createOpenAIEmbeddingProvider: mocks.createOpenAIEmbeddingProvider,
}));

vi.mock("../src/indexing/sqlite-store.ts", () => ({
  createSqliteStoreFromDatabase: mocks.createSqliteStoreFromDatabase,
}));

vi.mock("../src/indexing/sqlite-hash-store.ts", () => ({
  createSqliteHashStore: mocks.createSqliteHashStore,
}));

vi.mock("../src/pipeline.ts", () => ({
  runPipeline: mocks.runPipeline,
}));

describe("main", () => {
  beforeEach(() => {
    process.exitCode = undefined;
    mocks.MockDatabase.instances.length = 0;
    mocks.hashStores.length = 0;
    mocks.indexStores.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("rejects an invalid threshold before scanning or opening stores", async () => {
    await main(["--threshold", "abc"]);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Error: threshold must be a number between 0.0 and 1.0, got: "abc"',
    );
    expect(mocks.parserInit).not.toHaveBeenCalled();
    expect(mocks.createSqliteStoreFromDatabase).not.toHaveBeenCalled();
    expect(mocks.MockDatabase.instances).toHaveLength(0);
  });

  it.each(["-0.1", "1.1"])("rejects out-of-range threshold %s", async (threshold) => {
    await main([`--threshold=${threshold}`]);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      `Error: threshold must be a number between 0.0 and 1.0, got: "${threshold}"`,
    );
    expect(mocks.runPipeline).not.toHaveBeenCalled();
  });

  it("uses one shared database connection for the index and hash stores", async () => {
    await main(["--threshold", "0.75"]);

    expect(process.exitCode).toBeUndefined();
    expect(mocks.MockDatabase.instances).toHaveLength(1);
    expect(mocks.createSqliteStoreFromDatabase).toHaveBeenCalledWith(
      mocks.MockDatabase.instances[0],
    );
    expect(mocks.createSqliteHashStore).toHaveBeenCalledWith(mocks.MockDatabase.instances[0]);
    expect(mocks.runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        store: mocks.indexStores[0],
        threshold: 0.75,
        hashStore: mocks.hashStores[0],
      }),
    );
    expect(mocks.indexStores[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.hashStores[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.MockDatabase.instances[0].close).toHaveBeenCalledTimes(1);
    expect(mocks.MockDatabase.instances[0].open).toBe(false);
  });
});
