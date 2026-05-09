import { beforeAll, describe, expect, it } from "vitest";
import { Parser } from "web-tree-sitter";
import {
  createDefaultLanguageParser,
  createMultiLanguageParser,
} from "../../src/scanning/multi-language-parser.ts";
import type { LanguageParser } from "../../src/types.ts";

interface LanguageExample {
  language: string;
  filePath: string;
  source: string;
  expected: Array<[unitType: string, name: string | null]>;
}

const examples: LanguageExample[] = [
  {
    language: "rust",
    filePath: "src/lib.rs",
    source: [
      "pub fn add(a: i32, b: i32) -> i32 {",
      "  a + b",
      "}",
      "",
      "impl Calculator {",
      "  pub fn sub(&self, a: i32, b: i32) -> i32 { a - b }",
      "}",
    ].join("\n"),
    expected: [
      ["function_item", "add"],
      ["impl_item", "Calculator"],
      ["function_item", "sub"],
    ],
  },
  {
    language: "csharp",
    filePath: "Calculator.cs",
    source: [
      "namespace Demo;",
      "class Calculator {",
      "  public int Add(int a, int b) { return a + b; }",
      "}",
    ].join("\n"),
    expected: [
      ["class_declaration", "Calculator"],
      ["method_declaration", "Add"],
    ],
  },
  {
    language: "cpp",
    filePath: "calculator.cpp",
    source: [
      "int add(int a, int b) {",
      "  return a + b;",
      "}",
      "",
      "class Calculator {",
      "public:",
      "  int Sub(int a, int b) { return a - b; }",
      "};",
    ].join("\n"),
    expected: [
      ["function_definition", "add"],
      ["class_specifier", "Calculator"],
      ["function_definition", "Sub"],
    ],
  },
  {
    language: "c",
    filePath: "calculator.c",
    source: [
      "int add(int a, int b) {",
      "  return a + b;",
      "}",
      "static int sub(int a, int b) { return a - b; }",
    ].join("\n"),
    expected: [
      ["function_definition", "add"],
      ["function_definition", "sub"],
    ],
  },
  {
    language: "zig",
    filePath: "calculator.zig",
    source: [
      "pub fn add(a: i32, b: i32) i32 {",
      "    return a + b;",
      "}",
      "const Calculator = struct {",
      "    pub fn sub(self: Calculator, a: i32, b: i32) i32 { return a - b; }",
      "};",
    ].join("\n"),
    expected: [
      ["function_declaration", "add"],
      ["struct_declaration", "Calculator"],
      ["function_declaration", "sub"],
    ],
  },
  {
    language: "go",
    filePath: "calculator.go",
    source: [
      "package calculator",
      "",
      "func Add(a int, b int) int {",
      "  return a + b",
      "}",
      "type Calculator struct{}",
      "func (c Calculator) Sub(a int, b int) int { return a - b }",
    ].join("\n"),
    expected: [
      ["function_declaration", "Add"],
      ["method_declaration", "Sub"],
    ],
  },
  {
    language: "python",
    filePath: "calculator.py",
    source: [
      "def add(a, b):",
      "    return a + b",
      "",
      "class Calculator:",
      "    def sub(self, a, b):",
      "        return a - b",
    ].join("\n"),
    expected: [
      ["function_definition", "add"],
      ["class_definition", "Calculator"],
      ["function_definition", "sub"],
    ],
  },
];

describe("createDefaultLanguageParser", () => {
  let parser: LanguageParser;

  beforeAll(async () => {
    await Parser.init();
    parser = await createDefaultLanguageParser();
  });

  it("supports TypeScript/JavaScript plus Rust, C#, C++, C, Zig, Go, and Python extensions", () => {
    expect(parser.extensions).toEqual(
      expect.arrayContaining([
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".rs",
        ".cs",
        ".cpp",
        ".cc",
        ".cxx",
        ".hpp",
        ".h",
        ".c",
        ".zig",
        ".go",
        ".py",
      ]),
    );
  });

  it.each(examples)("extracts semantic units from $language", async (example) => {
    const units = await parser.parse(example.filePath, example.source);

    expect(units.map((unit) => [unit.unitType, unit.name])).toEqual(example.expected);
    expect(units.every((unit) => unit.language === example.language)).toBe(true);
    expect(units.every((unit) => unit.filePath === example.filePath)).toBe(true);
    expect(units.every((unit) => unit.source.length > 0)).toBe(true);
  });

  it("still extracts TypeScript declarations through the default parser", async () => {
    const source = [
      "export function greet(name: string) {",
      "  return `Hello, ${name}`;",
      "}",
      "export const double = (value: number) => value * 2;",
    ].join("\n");

    const units = await parser.parse("greetings.ts", source);

    expect(units.map((unit) => [unit.unitType, unit.name, unit.language])).toEqual([
      ["function_declaration", "greet", "typescript"],
      ["arrow_function", "double", "typescript"],
    ]);
  });

  it.each([
    ["component.tsx", "export function Component() { return <div>Hello</div>; }"],
    ["component.jsx", "export const Component = () => <div>Hello</div>;"],
  ])("extracts declarations from JSX syntax in %s", async (filePath, source) => {
    const units = await parser.parse(filePath, source);

    expect(units).toHaveLength(1);
    expect(units[0].name).toBe("Component");
    expect(units[0].language).toBe("typescript");
  });

  it("names Rust trait impl units after the implementing type", async () => {
    const units = await parser.parse(
      "display.rs",
      "impl std::fmt::Display for Foo { fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { Ok(()) } }",
    );

    expect(units.map((unit) => [unit.unitType, unit.name])).toEqual([
      ["impl_item", "Foo"],
      ["function_item", "fmt"],
    ]);
  });

  it.each([
    [
      "csharp",
      "Calculator.cs",
      "class Calculator { public int Add(int a, int b) { return a + b; } }",
    ],
    [
      "cpp",
      "calculator.cpp",
      "class Calculator { public: int Add(int a, int b) { return a + b; } };",
    ],
    [
      "rust",
      "calculator.rs",
      "impl Calculator { pub fn add(&self, a: i32, b: i32) -> i32 { a + b } }",
    ],
    [
      "zig",
      "calculator.zig",
      "const Calculator = struct { pub fn add(self: Calculator, a: i32, b: i32) i32 { return a + b; } };",
    ],
  ])("assigns unique IDs to nested one-line %s units", async (_language, filePath, source) => {
    const units = await parser.parse(filePath, source);
    const ids = units.map((unit) => unit.id);

    expect(units.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not eagerly load language grammars when creating a parser", async () => {
    const lazyParser = await createMultiLanguageParser([
      {
        language: "missing",
        extensions: [".missing"],
        wasmModule: "definitely-not-a-real-tree-sitter-grammar/package.wasm",
        rules: [],
      },
    ]);

    expect(lazyParser.extensions).toEqual([".missing"]);
    await expect(lazyParser.parse("example.missing", "")).rejects.toThrow();
  });
});
