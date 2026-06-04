import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "bun:test";
import { Language, Parser } from "web-tree-sitter";
import { extractCodeUnitsFromRootNode } from "../../src/scanning/typescript-unit-extractor.ts";
import { makeUnitId } from "../../src/types.ts";

const require = createRequire(import.meta.url);

describe("extractCodeUnitsFromRootNode", () => {
  let parser: Parser;

  beforeAll(async () => {
    await Parser.init();
    const tsWasmPath = require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm");
    const tsLanguage = await Language.load(tsWasmPath);

    parser = new Parser();
    parser.setLanguage(tsLanguage);
  });

  it("extracts top-level TypeScript declarations from a parsed root node", () => {
    const source = [
      "export function greet(name: string) {",
      "  return `Hello, ${name}`;",
      "}",
      "",
      "export const transform = (value: number) => value * 2;",
      "",
      "export class Worker {",
      "  run() {",
      "    return true;",
      "  }",
      "}",
    ].join("\n");
    const tree = parser.parse(source);

    expect(tree).not.toBeNull();
    const units = extractCodeUnitsFromRootNode(tree!.rootNode, "example.ts", "typescript");

    expect(units.map((unit) => [unit.unitType, unit.name, unit.startLine, unit.endLine])).toEqual([
      ["function_declaration", "greet", 1, 3],
      ["arrow_function", "transform", 5, 5],
      ["class_declaration", "Worker", 7, 11],
      ["method_definition", "run", 8, 10],
    ]);
    expect(units[0].id).toBe(makeUnitId("example.ts", 1, 3));
    expect(units[1]).toMatchObject({
      id: makeUnitId("example.ts", 5, 5),
      source: "const transform = (value: number) => value * 2;",
    });
    expect(units.every((unit) => unit.filePath === "example.ts")).toBe(true);
    expect(units.every((unit) => unit.language === "typescript")).toBe(true);
  });

  it("does not extract nested function-like declarations from function bodies", () => {
    const source = [
      "export function outer() {",
      "  const inner = () => true;",
      "  function nested() {",
      "    return false;",
      "  }",
      "}",
      "",
      "const top = function () {",
      "  return true;",
      "};",
    ].join("\n");
    const tree = parser.parse(source);

    expect(tree).not.toBeNull();
    const units = extractCodeUnitsFromRootNode(tree!.rootNode, "nested.ts", "typescript");

    expect(units.map((unit) => [unit.unitType, unit.name, unit.startLine, unit.endLine])).toEqual([
      ["function_declaration", "outer", 1, 6],
      ["function_expression", "top", 8, 10],
    ]);
    expect(units.map((unit) => unit.name)).not.toContain("inner");
    expect(units.map((unit) => unit.name)).not.toContain("nested");
  });
});
