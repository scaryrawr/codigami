import { beforeAll, describe, expect, it } from "vitest";
import { Parser } from "web-tree-sitter";
import { createTypescriptParser } from "../../src/scanning/typescript-parser.ts";
import type { LanguageParser } from "../../src/types.ts";
import { makeUnitId } from "../../src/types.ts";

describe("createTypescriptParser", () => {
  let parser: LanguageParser;

  beforeAll(async () => {
    await Parser.init();
    parser = await createTypescriptParser();
  });

  it("has language set to typescript", () => {
    expect(parser.language).toBe("typescript");
  });

  it("supports .ts, .tsx, .js, and .jsx extensions", () => {
    expect(parser.extensions).toContain(".ts");
    expect(parser.extensions).toContain(".tsx");
    expect(parser.extensions).toContain(".js");
    expect(parser.extensions).toContain(".jsx");
  });

  describe("function declarations", () => {
    it("extracts a named function declaration", async () => {
      const source = `function greet(name: string): string {\n  return "Hello, " + name;\n}`;
      const units = await parser.parse("example.ts", source);

      expect(units).toHaveLength(1);
      expect(units[0].unitType).toBe("function_declaration");
      expect(units[0].name).toBe("greet");
      expect(units[0].startLine).toBe(1);
      expect(units[0].endLine).toBe(3);
      expect(units[0].source).toBe(source);
      expect(units[0].filePath).toBe("example.ts");
      expect(units[0].language).toBe("typescript");
      expect(units[0].id).toBe(makeUnitId("example.ts", 1, 3));
    });

    it("extracts multiple function declarations", async () => {
      const source = `function foo() {}\n\nfunction bar() {}`;
      const units = await parser.parse("multi.ts", source);

      const names = units.map((u) => u.name);
      expect(names).toContain("foo");
      expect(names).toContain("bar");
    });
  });

  describe("arrow functions", () => {
    it("extracts an arrow function assigned to a const", async () => {
      const source = `const add = (a: number, b: number): number => {\n  return a + b;\n};`;
      const units = await parser.parse("arrow.ts", source);

      expect(units).toHaveLength(1);
      expect(units[0].unitType).toBe("arrow_function");
      expect(units[0].name).toBe("add");
      expect(units[0].startLine).toBe(1);
      expect(units[0].endLine).toBe(3);
      expect(units[0].filePath).toBe("arrow.ts");
    });

    it("extracts an arrow function assigned to a let", async () => {
      const source = `let compute = () => 42;`;
      const units = await parser.parse("let-arrow.ts", source);

      expect(units).toHaveLength(1);
      expect(units[0].unitType).toBe("arrow_function");
      expect(units[0].name).toBe("compute");
    });

    it("extracts a function expression assigned to a const", async () => {
      const source = `const handler = function process() { return 1; };`;
      const units = await parser.parse("func-expr.ts", source);

      expect(units).toHaveLength(1);
      expect(units[0].name).toBe("handler");
    });
  });

  describe("class declarations", () => {
    it("extracts a class and its methods", async () => {
      const source = [
        "class Calculator {",
        "  add(a: number, b: number): number {",
        "    return a + b;",
        "  }",
        "",
        "  subtract(a: number, b: number): number {",
        "    return a - b;",
        "  }",
        "}",
      ].join("\n");

      const units = await parser.parse("calc.ts", source);

      const classUnit = units.find((u) => u.unitType === "class_declaration");
      expect(classUnit).toBeDefined();
      expect(classUnit!.name).toBe("Calculator");
      expect(classUnit!.startLine).toBe(1);
      expect(classUnit!.endLine).toBe(9);
      expect(classUnit!.source).toBe(source);

      const methods = units.filter((u) => u.unitType === "method_definition");
      expect(methods).toHaveLength(2);

      const addMethod = methods.find((u) => u.name === "add");
      expect(addMethod).toBeDefined();
      expect(addMethod!.startLine).toBe(2);
      expect(addMethod!.endLine).toBe(4);

      const subMethod = methods.find((u) => u.name === "subtract");
      expect(subMethod).toBeDefined();
      expect(subMethod!.startLine).toBe(6);
      expect(subMethod!.endLine).toBe(8);
    });
  });

  describe("exported declarations", () => {
    it("extracts an exported function", async () => {
      const source = `export function doWork(): void {}`;
      const units = await parser.parse("exported.ts", source);

      expect(units).toHaveLength(1);
      expect(units[0].unitType).toBe("function_declaration");
      expect(units[0].name).toBe("doWork");
    });

    it("extracts an exported class with methods", async () => {
      const source = [
        "export class Service {",
        "  run() {",
        "    return true;",
        "  }",
        "}",
      ].join("\n");

      const units = await parser.parse("service.ts", source);

      const classUnit = units.find((u) => u.unitType === "class_declaration");
      expect(classUnit).toBeDefined();
      expect(classUnit!.name).toBe("Service");

      const methodUnit = units.find((u) => u.unitType === "method_definition");
      expect(methodUnit).toBeDefined();
      expect(methodUnit!.name).toBe("run");
    });

    it("extracts an exported arrow function", async () => {
      const source = `export const transform = (x: number) => x * 2;`;
      const units = await parser.parse("transform.ts", source);

      expect(units).toHaveLength(1);
      expect(units[0].unitType).toBe("arrow_function");
      expect(units[0].name).toBe("transform");
    });
  });

  describe("empty / non-extractable sources", () => {
    it("returns empty array for an empty file", async () => {
      expect(await parser.parse("empty.ts", "")).toEqual([]);
    });

    it("returns empty array for only type declarations", async () => {
      const source = `type Foo = string;\ninterface Bar { x: number; }`;
      expect(await parser.parse("types.ts", source)).toEqual([]);
    });

    it("returns empty array for only import statements", async () => {
      const source = `import { readFile } from "node:fs";`;
      expect(await parser.parse("imports.ts", source)).toEqual([]);
    });

    it("returns empty array for only variable declarations without functions", async () => {
      const source = `const x = 42;\nlet y = "hello";`;
      expect(await parser.parse("vars.ts", source)).toEqual([]);
    });
  });

  describe("filePath handling", () => {
    it("preserves the filePath in all returned units", async () => {
      const source = `function a() {}\nfunction b() {}`;
      const units = await parser.parse("src/utils/helpers.ts", source);

      for (const unit of units) {
        expect(unit.filePath).toBe("src/utils/helpers.ts");
      }
    });
  });

  describe("source text", () => {
    it("captures the full source text of each unit", async () => {
      const fnSource = "function hello() {\n  console.log(\"hi\");\n}";
      const source = `const x = 1;\n${fnSource}\nconst y = 2;`;
      const units = await parser.parse("source.ts", source);

      expect(units).toHaveLength(1);
      expect(units[0].source).toBe(fnSource);
    });
  });
});
