import { beforeEach, describe, expect, it, vi } from "bun:test";

import { createMultiLanguageParser } from "../../src/scanning/multi-language-parser.ts";

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

describe("createMultiLanguageParser resource management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes parse trees after extraction", async () => {
    const parser = await createMultiLanguageParser(
      [
        {
          language: "test",
          extensions: [".test"],
          wasmModule: "tree-sitter-typescript/tree-sitter-typescript.wasm",
          extract: mocks.extract as never,
        },
      ],
      {
        loadLanguage: mocks.languageLoad as never,
        createParser,
        resolveWasmModule: (wasmModule) => wasmModule,
      },
    );

    await parser.parse("example.test", "source");

    expect(mocks.extract).toHaveBeenCalledTimes(1);
    expect(mocks.treeDelete).toHaveBeenCalledTimes(1);
  });

  it("deletes parse trees when extraction throws", async () => {
    const parser = await createMultiLanguageParser(
      [
        {
          language: "test",
          extensions: [".test"],
          wasmModule: "tree-sitter-typescript/tree-sitter-typescript.wasm",
          extract: mocks.extract as never,
        },
      ],
      {
        loadLanguage: mocks.languageLoad as never,
        createParser,
        resolveWasmModule: (wasmModule) => wasmModule,
      },
    );
    mocks.extract.mockImplementationOnce(() => {
      throw new Error("extract failed");
    });

    await expect(parser.parse("example.test", "source")).rejects.toThrow("extract failed");

    expect(mocks.treeDelete).toHaveBeenCalledTimes(1);
  });
});
