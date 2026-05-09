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

    parse(source: string): { rootNode: { type: string } } {
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

vi.mock("../../src/scanning/typescript-unit-extractor.ts", () => ({
  extractCodeUnitsFromRootNode: mocks.extract,
}));

describe("createTypescriptParser lazy loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not load a grammar until the first parse", async () => {
    const { createTypescriptParser } = await import("../../src/scanning/typescript-parser.ts");

    const parser = await createTypescriptParser();

    expect(parser.extensions).toEqual([".ts", ".tsx", ".js", ".jsx"]);
    expect(mocks.languageLoad).not.toHaveBeenCalled();
  });

  it("loads and reuses only the TypeScript grammar for .ts and .js files", async () => {
    const { createTypescriptParser } = await import("../../src/scanning/typescript-parser.ts");
    const parser = await createTypescriptParser();

    await parser.parse("example.ts", "function one() {}");
    await parser.parse("example.js", "function two() {}");

    expect(mocks.languageLoad).toHaveBeenCalledTimes(1);
    expect(mocks.languageLoad.mock.calls[0]?.[0]).toContain("tree-sitter-typescript.wasm");
    expect(mocks.setLanguage).toHaveBeenCalledTimes(1);
  });

  it("loads and reuses the TSX grammar only for .tsx and .jsx files", async () => {
    const { createTypescriptParser } = await import("../../src/scanning/typescript-parser.ts");
    const parser = await createTypescriptParser();

    await parser.parse("component.tsx", "export function Component() { return <div />; }");
    await parser.parse("component.jsx", "export const Component = () => <div />;");

    expect(mocks.languageLoad).toHaveBeenCalledTimes(1);
    expect(mocks.languageLoad.mock.calls[0]?.[0]).toContain("tree-sitter-tsx.wasm");
    expect(mocks.setLanguage).toHaveBeenCalledTimes(1);
  });

  it("loads each grammar at most once when both variants are parsed", async () => {
    const { createTypescriptParser } = await import("../../src/scanning/typescript-parser.ts");
    const parser = await createTypescriptParser();

    await parser.parse("example.ts", "function one() {}");
    await parser.parse("component.tsx", "export function Component() { return <div />; }");
    await parser.parse("another.ts", "function two() {}");
    await parser.parse("another.jsx", "export const Other = () => <span />;");

    expect(mocks.languageLoad).toHaveBeenCalledTimes(2);
    expect(mocks.languageLoad.mock.calls.map((call) => call[0])).toEqual([
      expect.stringContaining("tree-sitter-typescript.wasm"),
      expect.stringContaining("tree-sitter-tsx.wasm"),
    ]);
    expect(mocks.setLanguage).toHaveBeenCalledTimes(2);
  });

  it("deletes parse trees after extraction", async () => {
    const { createTypescriptParser } = await import("../../src/scanning/typescript-parser.ts");
    const parser = await createTypescriptParser();

    await parser.parse("example.ts", "function one() {}");

    expect(mocks.extract).toHaveBeenCalledTimes(1);
    expect(mocks.treeDelete).toHaveBeenCalledTimes(1);
  });

  it("deletes parse trees when extraction throws", async () => {
    const { createTypescriptParser } = await import("../../src/scanning/typescript-parser.ts");
    const parser = await createTypescriptParser();
    mocks.extract.mockImplementationOnce(() => {
      throw new Error("extract failed");
    });

    await expect(parser.parse("example.ts", "function one() {}")).rejects.toThrow("extract failed");

    expect(mocks.treeDelete).toHaveBeenCalledTimes(1);
  });
});
