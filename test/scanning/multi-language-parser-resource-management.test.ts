import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    languageLoad: vi.fn(async (path: string) => ({ path })),
    setLanguage: vi.fn(),
    treeDelete: vi.fn(),
    parse: vi.fn((_source: string) => ({
      rootNode: { type: "program" },
      delete: mocks.treeDelete,
    })),
    extract: vi.fn(() => []),
  };
});

vi.mock("web-tree-sitter", () => {
  class MockParser {
    setLanguage(language: unknown): void {
      mocks.setLanguage(language);
    }

    parse(source: string): { rootNode: { type: string }; delete: () => void } {
      return mocks.parse(source);
    }
  }

  return {
    Parser: MockParser,
    Language: {
      load: mocks.languageLoad,
    },
  };
});

describe("createMultiLanguageParser resource management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes parse trees after extraction", async () => {
    const { createMultiLanguageParser } =
      await import("../../src/scanning/multi-language-parser.ts");
    const parser = await createMultiLanguageParser([
      {
        language: "test",
        extensions: [".test"],
        wasmModule: "tree-sitter-typescript/tree-sitter-typescript.wasm",
        extract: mocks.extract,
      },
    ]);

    await parser.parse("example.test", "source");

    expect(mocks.extract).toHaveBeenCalledTimes(1);
    expect(mocks.treeDelete).toHaveBeenCalledTimes(1);
  });

  it("deletes parse trees when extraction throws", async () => {
    const { createMultiLanguageParser } =
      await import("../../src/scanning/multi-language-parser.ts");
    const parser = await createMultiLanguageParser([
      {
        language: "test",
        extensions: [".test"],
        wasmModule: "tree-sitter-typescript/tree-sitter-typescript.wasm",
        extract: mocks.extract,
      },
    ]);
    mocks.extract.mockImplementationOnce(() => {
      throw new Error("extract failed");
    });

    await expect(parser.parse("example.test", "source")).rejects.toThrow("extract failed");

    expect(mocks.treeDelete).toHaveBeenCalledTimes(1);
  });
});
