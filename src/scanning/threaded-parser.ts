import type { CodeUnit, LanguageParser } from "../types.ts";
import { createParserPool, type ParserPool, type ParserPoolOptions } from "./parser-pool.ts";

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

    parse(filePath: string, source: string): Promise<CodeUnit[]> {
      return pool.parse(filePath, source);
    },

    close(): Promise<void> {
      return pool.close();
    },
  };
};
