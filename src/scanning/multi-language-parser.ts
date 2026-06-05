import { extname } from "node:path";
import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";
import { CodigamiError, type CodeUnit, type LanguageParser } from "../types.ts";
import { DEFAULT_LANGUAGE_DEFINITIONS } from "./languages/index.ts";
import type { TreeSitterLanguageDefinition } from "./tree-sitter-language-definition.ts";
import { extractCodeUnitsByRules } from "./tree-sitter-unit-extractor.ts";

export { DEFAULT_LANGUAGE_DEFINITIONS, DEFAULT_LANGUAGE_EXTENSIONS } from "./languages/index.ts";
export type { TreeSitterLanguageDefinition } from "./tree-sitter-language-definition.ts";

const require = createRequire(import.meta.url);
const MULTI_LANGUAGE_PARSER_CACHE_VERSION = "multi-language-parser:v2";

interface LoadedLanguageParser {
  readonly language: string;
  readonly extensions: readonly string[];
  parse(filePath: string, source: string): CodeUnit[];
}

interface TreeSitterParserDependencies {
  loadLanguage(wasmPath: string): Promise<Language>;
  createParser(): Parser;
  resolveWasmModule(wasmModule: string): string;
}

const defaultParserDependencies: TreeSitterParserDependencies = {
  loadLanguage: (wasmPath: string) => Language.load(wasmPath),
  createParser: () => new Parser(),
  resolveWasmModule: (wasmModule: string) => require.resolve(wasmModule),
};

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
  dependencies: TreeSitterParserDependencies,
): Promise<LoadedLanguageParser> => {
  const language = await dependencies.loadLanguage(
    dependencies.resolveWasmModule(definition.wasmModule),
  );
  const parser = dependencies.createParser();
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
  dependencies: TreeSitterParserDependencies = defaultParserDependencies,
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

    const loading = loadLanguageParser(definition, dependencies);
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
