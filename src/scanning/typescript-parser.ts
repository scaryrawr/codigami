import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";
import { type CodeUnit, type LanguageParser } from "../types.ts";
import { extractCodeUnitsFromRootNode } from "./typescript-unit-extractor.ts";

const require = createRequire(import.meta.url);

export const createTypescriptParser = async (): Promise<LanguageParser> => {
  const tsWasmPath = require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm");
  const tsLanguage = await Language.load(tsWasmPath);

  const tsParser = new Parser();
  tsParser.setLanguage(tsLanguage);

  const lang = "typescript";

  return {
    language: lang,
    extensions: [".ts", ".tsx", ".js", ".jsx"] as const,

    async parse(filePath: string, source: string): Promise<CodeUnit[]> {
      const tree = tsParser.parse(source);
      if (!tree) return [];

      return extractCodeUnitsFromRootNode(tree.rootNode, filePath, lang);
    },
  };
};
