import type { CodeUnit, LanguageParser } from "../types.ts";
import { createParserPool, type ParserPool, type ParserPoolOptions } from "./parser-pool.ts";
import { TYPESCRIPT_PARSER_CACHE_KEY } from "./typescript-parser.ts";

export interface ThreadedLanguageParser extends LanguageParser {
  close(): Promise<void>;
}

export const createThreadedTypescriptParser = async (
  options?: ParserPoolOptions,
): Promise<ThreadedLanguageParser> => {
  const pool: ParserPool = await createParserPool(options);

  return {
    language: "typescript",
    extensions: [".ts", ".tsx", ".js", ".jsx"] as const,
    cacheKey: TYPESCRIPT_PARSER_CACHE_KEY,

    parse(filePath: string, source: string): Promise<CodeUnit[]> {
      return pool.parse(filePath, source);
    },

    close(): Promise<void> {
      return pool.close();
    },
  };
};
