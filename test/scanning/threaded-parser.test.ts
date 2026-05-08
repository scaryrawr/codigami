import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Parser } from "web-tree-sitter";
import { createThreadedTypescriptParser, type ThreadedLanguageParser } from "../../src/scanning/threaded-parser.ts";
import { createTypescriptParser } from "../../src/scanning/typescript-parser.ts";
import type { LanguageParser } from "../../src/types.ts";

describe("createThreadedTypescriptParser", () => {
  let threadedParser: ThreadedLanguageParser;

  beforeAll(async () => {
    await Parser.init();
    threadedParser = await createThreadedTypescriptParser({ poolSize: 2 });
  });

  afterAll(async () => {
    await threadedParser.close();
  });

  it("has language set to typescript", () => {
    expect(threadedParser.language).toBe("typescript");
  });

  it("supports .ts, .tsx, .js, and .jsx extensions", () => {
    expect(threadedParser.extensions).toContain(".ts");
    expect(threadedParser.extensions).toContain(".tsx");
    expect(threadedParser.extensions).toContain(".js");
    expect(threadedParser.extensions).toContain(".jsx");
  });

  it("extracts a function declaration", async () => {
    const source = `function greet(name: string): string {\n  return "Hello, " + name;\n}`;
    const units = await threadedParser.parse("example.ts", source);

    expect(units).toHaveLength(1);
    expect(units[0].unitType).toBe("function_declaration");
    expect(units[0].name).toBe("greet");
    expect(units[0].filePath).toBe("example.ts");
    expect(units[0].language).toBe("typescript");
  });

  it("extracts arrow functions", async () => {
    const source = `const add = (a: number, b: number) => a + b;`;
    const units = await threadedParser.parse("arrow.ts", source);

    expect(units).toHaveLength(1);
    expect(units[0].unitType).toBe("arrow_function");
    expect(units[0].name).toBe("add");
  });

  it("extracts class declarations with methods", async () => {
    const source = [
      "class Calculator {",
      "  add(a: number, b: number): number {",
      "    return a + b;",
      "  }",
      "}",
    ].join("\n");

    const units = await threadedParser.parse("calc.ts", source);

    const classUnit = units.find((u) => u.unitType === "class_declaration");
    expect(classUnit).toBeDefined();
    expect(classUnit!.name).toBe("Calculator");

    const methods = units.filter((u) => u.unitType === "method_definition");
    expect(methods).toHaveLength(1);
    expect(methods[0].name).toBe("add");
  });

  it("returns empty array for non-extractable source", async () => {
    const source = `const x = 42;\ntype Foo = string;`;
    const units = await threadedParser.parse("empty.ts", source);
    expect(units).toEqual([]);
  });

  it("handles concurrent parse requests", async () => {
    const sources = Array.from({ length: 10 }, (_, i) => ({
      filePath: `file${i}.ts`,
      source: `function fn${i}() { return ${i}; }`,
    }));

    const results = await Promise.all(
      sources.map((s) => threadedParser.parse(s.filePath, s.source)),
    );

    expect(results).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(results[i]).toHaveLength(1);
      expect(results[i][0].name).toBe(`fn${i}`);
      expect(results[i][0].filePath).toBe(`file${i}.ts`);
    }
  });

  it("produces identical results to the sync parser", async () => {
    const syncParser: LanguageParser = await createTypescriptParser();

    const source = [
      "export function hello() { return 'hi'; }",
      "",
      "export const transform = (x: number) => x * 2;",
      "",
      "export class Service {",
      "  run() { return true; }",
      "  stop() { return false; }",
      "}",
    ].join("\n");

    const syncUnits = await syncParser.parse("test.ts", source);
    const threadedUnits = await threadedParser.parse("test.ts", source);

    expect(threadedUnits).toEqual(syncUnits);
  });
});
