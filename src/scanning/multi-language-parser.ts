import { extname } from "node:path";
import { createRequire } from "node:module";
import { Language, type Node, Parser } from "web-tree-sitter";
import { CodigamiError, type CodeUnit, type LanguageParser } from "../types.ts";
import { extractCodeUnitsFromRootNode as extractTypescriptCodeUnits } from "./typescript-unit-extractor.ts";
import {
  extractCodeUnitsByRules,
  hasChildOfType,
  nameFromDeclarator,
  nameFromField,
  nameFromFirstChild,
  type UnitExtractionRule,
} from "./tree-sitter-unit-extractor.ts";

const require = createRequire(import.meta.url);
const MULTI_LANGUAGE_PARSER_CACHE_VERSION = "multi-language-parser:v2";

export interface TreeSitterLanguageDefinition {
  readonly language: string;
  readonly extensions: readonly string[];
  readonly wasmModule: string;
  readonly cacheKey?: string;
  readonly rules?: readonly UnitExtractionRule[];
  readonly extract?: (rootNode: Node, filePath: string, language: string) => CodeUnit[];
}

interface LoadedLanguageParser {
  readonly language: string;
  readonly extensions: readonly string[];
  parse(filePath: string, source: string): CodeUnit[];
}

const nameFromRustImpl = (node: Node): string | null => {
  return (
    node.childForFieldName("type")?.text ??
    node.childForFieldName("trait")?.text ??
    nameFromFirstChild("type_identifier", "scoped_type_identifier", "generic_type")(node)
  );
};

const RUST_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "function_item",
    unitType: "function_item",
    getName: nameFromField,
  },
  {
    nodeType: "impl_item",
    unitType: "impl_item",
    getName: nameFromRustImpl,
    descendIntoChildren: true,
  },
];

const CSHARP_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "class_declaration",
    unitType: "class_declaration",
    getName: nameFromField,
    descendIntoChildren: true,
  },
  {
    nodeType: "struct_declaration",
    unitType: "struct_declaration",
    getName: nameFromField,
    descendIntoChildren: true,
  },
  {
    nodeType: "record_declaration",
    unitType: "record_declaration",
    getName: nameFromField,
    descendIntoChildren: true,
  },
  {
    nodeType: "method_declaration",
    unitType: "method_declaration",
    getName: nameFromField,
  },
  {
    nodeType: "constructor_declaration",
    unitType: "constructor_declaration",
    getName: nameFromField,
  },
];

const C_FAMILY_FUNCTION_RULE: UnitExtractionRule = {
  nodeType: "function_definition",
  unitType: "function_definition",
  getName: nameFromDeclarator,
};

const CPP_RULES: readonly UnitExtractionRule[] = [
  C_FAMILY_FUNCTION_RULE,
  {
    nodeType: "class_specifier",
    unitType: "class_specifier",
    getName: nameFromField,
    descendIntoChildren: true,
  },
  {
    nodeType: "struct_specifier",
    unitType: "struct_specifier",
    getName: nameFromField,
    descendIntoChildren: true,
  },
];

const C_RULES: readonly UnitExtractionRule[] = [C_FAMILY_FUNCTION_RULE];

const ZIG_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "function_declaration",
    unitType: "function_declaration",
    getName: nameFromField,
  },
  {
    nodeType: "variable_declaration",
    unitType: "struct_declaration",
    getName: nameFromFirstChild("identifier"),
    shouldExtract: hasChildOfType("struct_declaration"),
    descendIntoChildren: true,
  },
];

const GO_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "function_declaration",
    unitType: "function_declaration",
    getName: nameFromField,
  },
  {
    nodeType: "method_declaration",
    unitType: "method_declaration",
    getName: nameFromField,
  },
];

const PYTHON_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "function_definition",
    unitType: "function_definition",
    getName: nameFromField,
  },
  {
    nodeType: "class_definition",
    unitType: "class_definition",
    getName: nameFromField,
    descendIntoChildren: true,
  },
];

export const DEFAULT_LANGUAGE_DEFINITIONS: readonly TreeSitterLanguageDefinition[] = [
  {
    language: "typescript",
    extensions: [".ts", ".js"],
    wasmModule: "tree-sitter-typescript/tree-sitter-typescript.wasm",
    extract: extractTypescriptCodeUnits,
  },
  {
    language: "typescript",
    extensions: [".tsx", ".jsx"],
    wasmModule: "tree-sitter-typescript/tree-sitter-tsx.wasm",
    extract: extractTypescriptCodeUnits,
  },
  {
    language: "rust",
    extensions: [".rs"],
    wasmModule: "tree-sitter-rust/tree-sitter-rust.wasm",
    rules: RUST_RULES,
  },
  {
    language: "csharp",
    extensions: [".cs"],
    wasmModule: "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm",
    rules: CSHARP_RULES,
  },
  {
    language: "cpp",
    extensions: [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hh", ".hxx", ".h++", ".h"],
    wasmModule: "tree-sitter-cpp/tree-sitter-cpp.wasm",
    rules: CPP_RULES,
  },
  {
    language: "c",
    extensions: [".c"],
    wasmModule: "tree-sitter-c/tree-sitter-c.wasm",
    rules: C_RULES,
  },
  {
    language: "zig",
    extensions: [".zig"],
    wasmModule: "@tree-sitter-grammars/tree-sitter-zig/tree-sitter-zig.wasm",
    rules: ZIG_RULES,
  },
  {
    language: "go",
    extensions: [".go"],
    wasmModule: "tree-sitter-go/tree-sitter-go.wasm",
    rules: GO_RULES,
  },
  {
    language: "python",
    extensions: [".py"],
    wasmModule: "tree-sitter-python/tree-sitter-python.wasm",
    rules: PYTHON_RULES,
  },
];

export const DEFAULT_LANGUAGE_EXTENSIONS: readonly string[] = Array.from(
  new Set(DEFAULT_LANGUAGE_DEFINITIONS.flatMap((definition) => definition.extensions)),
);

const createLanguageParserCacheKey = (
  definitions: readonly TreeSitterLanguageDefinition[],
): string => {
  const normalizedDefinitions = definitions.map((definition) => ({
    language: definition.language,
    extensions: [...definition.extensions],
    wasmModule: definition.wasmModule,
    cacheKey: definition.cacheKey,
    rules: definition.rules?.map((rule) => ({
      nodeType: rule.nodeType,
      unitType: typeof rule.unitType === "string" ? rule.unitType : "<dynamic>",
      hasGetName: rule.getName !== undefined,
      hasShouldExtract: rule.shouldExtract !== undefined,
      descendIntoChildren: rule.descendIntoChildren ?? false,
    })),
    hasCustomExtract: definition.extract !== undefined,
  }));

  return `${MULTI_LANGUAGE_PARSER_CACHE_VERSION}:${JSON.stringify(normalizedDefinitions)}`;
};

const loadLanguageParser = async (
  definition: TreeSitterLanguageDefinition,
): Promise<LoadedLanguageParser> => {
  const language = await Language.load(require.resolve(definition.wasmModule));
  const parser = new Parser();
  parser.setLanguage(language);

  return {
    language: definition.language,
    extensions: definition.extensions,
    parse(filePath: string, source: string): CodeUnit[] {
      const tree = parser.parse(source);
      if (!tree) return [];

      try {
        if (definition.extract) {
          return definition.extract(tree.rootNode, filePath, definition.language);
        }

        if (!definition.rules) return [];

        return extractCodeUnitsByRules(
          tree.rootNode,
          filePath,
          definition.language,
          definition.rules,
        );
      } finally {
        tree.delete();
      }
    },
  };
};

export const createMultiLanguageParser = async (
  definitions: readonly TreeSitterLanguageDefinition[] = DEFAULT_LANGUAGE_DEFINITIONS,
): Promise<LanguageParser> => {
  const definitionByExtension = new Map<string, TreeSitterLanguageDefinition>();
  const parserLoadByDefinition = new Map<
    TreeSitterLanguageDefinition,
    Promise<LoadedLanguageParser>
  >();
  const extensions: string[] = [];

  for (const definition of definitions) {
    for (const extension of definition.extensions) {
      if (!definitionByExtension.has(extension)) {
        extensions.push(extension);
      }
      definitionByExtension.set(extension, definition);
    }
  }

  const getLoadedParser = (
    definition: TreeSitterLanguageDefinition,
  ): Promise<LoadedLanguageParser> => {
    const existing = parserLoadByDefinition.get(definition);
    if (existing) return existing;

    const loading = loadLanguageParser(definition);
    parserLoadByDefinition.set(definition, loading);
    return loading;
  };

  return {
    language: "multi",
    extensions,
    cacheKey: createLanguageParserCacheKey(definitions),

    async parse(filePath: string, source: string): Promise<CodeUnit[]> {
      const extension = extname(filePath);
      const definition = definitionByExtension.get(extension);
      if (!definition) {
        throw new CodigamiError("No parser registered for file extension", {
          filePath,
          extension,
          supportedExtensions: extensions.join(","),
        });
      }

      const parser = await getLoadedParser(definition);
      return parser.parse(filePath, source);
    },
  };
};

export const createDefaultLanguageParser = async (): Promise<LanguageParser> => {
  return createMultiLanguageParser(DEFAULT_LANGUAGE_DEFINITIONS);
};
