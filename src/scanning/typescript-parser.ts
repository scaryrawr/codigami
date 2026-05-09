import { type CodeUnit, type LanguageParser } from "../types.ts";
import { createLazyTypescriptParserLoader } from "./typescript-parser-loader.ts";
import { extractCodeUnitsFromRootNode } from "./typescript-unit-extractor.ts";

export const TYPESCRIPT_PARSER_CACHE_KEY = "typescript-parser:v2:tsx-grammar:unique-unit-ids";

export const createTypescriptParser = async (): Promise<LanguageParser> => {
  const parserLoader = createLazyTypescriptParserLoader();
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
        return extractCodeUnitsFromRootNode(tree.rootNode, filePath, lang);
      } finally {
        tree.delete();
      }
    },
  };
};
