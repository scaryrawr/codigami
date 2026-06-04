import { beforeEach, describe, expect, it, vi } from "bun:test";
import { createTypescriptParser } from "../../src/scanning/typescript-parser.ts";
import { createLazyTypescriptParserLoader } from "../../src/scanning/typescript-parser-loader.ts";

const mocks = {
  languageLoad: vi.fn(async (path: string) => ({ path })),
  setLanguage: vi.fn(),
  treeDelete: vi.fn(),
  parse: vi.fn((_source: string) => ({
    rootNode: { type: "program" },
    delete: mocks.treeDelete,
  })),
  extract: vi.fn(() => []),
};

const createParser = () =>
  ({
    setLanguage: mocks.setLanguage,
    parse: mocks.parse,
  }) as never;

describe("createTypescriptParser lazy loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not request a parser until the first parse", async () => {
    const parserLoader = {
      getParserForFilePath: vi.fn(async () => createParser()),
    };

    const parser = await createTypescriptParser({
      parserLoader,
      extractCodeUnitsFromRootNode: mocks.extract,
    });

    expect(parser.extensions).toEqual([".ts", ".tsx", ".js", ".jsx"]);
    expect(parserLoader.getParserForFilePath).not.toHaveBeenCalled();

    await parser.parse("example.ts", "function one() {}");

    expect(parserLoader.getParserForFilePath).toHaveBeenCalledWith("example.ts");
  });

  it("loads and reuses only the TypeScript grammar for .ts and .js files", async () => {
    const parserLoader = createLazyTypescriptParserLoader({
      loadLanguage: mocks.languageLoad as never,
      createParser,
      resolveWasmModule: (wasmModule) => wasmModule,
    });

    await parserLoader.getParserForFilePath("example.ts");
    await parserLoader.getParserForFilePath("example.js");

    expect(mocks.languageLoad).toHaveBeenCalledTimes(1);
    expect(mocks.languageLoad.mock.calls[0]?.[0]).toContain("tree-sitter-typescript.wasm");
    expect(mocks.setLanguage).toHaveBeenCalledTimes(1);
  });

  it("loads and reuses the TSX grammar only for .tsx and .jsx files", async () => {
    const parserLoader = createLazyTypescriptParserLoader({
      loadLanguage: mocks.languageLoad as never,
      createParser,
      resolveWasmModule: (wasmModule) => wasmModule,
    });

    await parserLoader.getParserForFilePath("component.tsx");
    await parserLoader.getParserForFilePath("component.jsx");

    expect(mocks.languageLoad).toHaveBeenCalledTimes(1);
    expect(mocks.languageLoad.mock.calls[0]?.[0]).toContain("tree-sitter-tsx.wasm");
    expect(mocks.setLanguage).toHaveBeenCalledTimes(1);
  });

  it("loads each grammar at most once when both variants are parsed", async () => {
    const parserLoader = createLazyTypescriptParserLoader({
      loadLanguage: mocks.languageLoad as never,
      createParser,
      resolveWasmModule: (wasmModule) => wasmModule,
    });

    await parserLoader.getParserForFilePath("example.ts");
    await parserLoader.getParserForFilePath("component.tsx");
    await parserLoader.getParserForFilePath("another.ts");
    await parserLoader.getParserForFilePath("another.jsx");

    expect(mocks.languageLoad).toHaveBeenCalledTimes(2);
    expect(mocks.languageLoad.mock.calls.map((call) => call[0])).toEqual([
      expect.stringContaining("tree-sitter-typescript.wasm"),
      expect.stringContaining("tree-sitter-tsx.wasm"),
    ]);
    expect(mocks.setLanguage).toHaveBeenCalledTimes(2);
  });

  it("deletes parse trees after extraction", async () => {
    const parser = await createTypescriptParser({
      parserLoader: { getParserForFilePath: vi.fn(async () => createParser()) },
      extractCodeUnitsFromRootNode: mocks.extract,
    });

    await parser.parse("example.ts", "function one() {}");

    expect(mocks.extract).toHaveBeenCalledTimes(1);
    expect(mocks.treeDelete).toHaveBeenCalledTimes(1);
  });

  it("deletes parse trees when extraction throws", async () => {
    const parser = await createTypescriptParser({
      parserLoader: { getParserForFilePath: vi.fn(async () => createParser()) },
      extractCodeUnitsFromRootNode: mocks.extract,
    });
    mocks.extract.mockImplementationOnce(() => {
      throw new Error("extract failed");
    });

    await expect(parser.parse("example.ts", "function one() {}")).rejects.toThrow("extract failed");

    expect(mocks.treeDelete).toHaveBeenCalledTimes(1);
  });
});
