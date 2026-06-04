import { type CodeUnit, type LanguageParser } from "../types.ts";
import {
  createLazyTypescriptParserLoader,
  type LazyTypescriptParserLoader,
} from "./typescript-parser-loader.ts";
import { extractCodeUnitsFromRootNode } from "./typescript-unit-extractor.ts";

export const TYPESCRIPT_PARSER_CACHE_KEY = "typescript-parser:v2:tsx-grammar:unique-unit-ids";

export interface TypescriptParserDependencies {
  parserLoader?: LazyTypescriptParserLoader;
  extractCodeUnitsFromRootNode?: typeof extractCodeUnitsFromRootNode;
}

export const createTypescriptParser = async (
  dependencies: TypescriptParserDependencies = {},
): Promise<LanguageParser> => {
  const parserLoader = dependencies.parserLoader ?? createLazyTypescriptParserLoader();
  const extract = dependencies.extractCodeUnitsFromRootNode ?? extractCodeUnitsFromRootNode;
  const lang = "typescript";

  return {
    language: lang,
    extensions: [".ts", ".tsx", ".js", ".jsx"] as const,
    cacheKey: TYPESCRIPT_PARSER_CACHE_KEY,

    async parse(filePath: string, source: string): Promise<CodeUnit[]> {
      const parser = await parserLoader.getParserForFilePath(filePath);
      const tree = parser.parse(source);
      if (!tree) return [];

      try {
        return extract(tree.rootNode, filePath, lang);
      } finally {
        tree.delete();
      }
    },
  };
};
