// Public API
export type {
  CodeUnit,
  ComparisonLevel,
  DuplicateCluster,
  DuplicatePair,
  DuplicateReport,
  EmbeddingProvider,
  IndexStore,
  LanguageParser,
  PipelineConfig,
  CodigamiError,
} from "./types.ts";
export { makeUnitId } from "./types.ts";

export { walkDirectories, walkDirectory } from "./scanning/file-walker.ts";
export type { DiscoveredFile } from "./scanning/file-walker.ts";
export { createTypescriptParser } from "./scanning/typescript-parser.ts";
export {
  createDefaultLanguageParser,
  createMultiLanguageParser,
  DEFAULT_LANGUAGE_DEFINITIONS,
  DEFAULT_LANGUAGE_EXTENSIONS,
} from "./scanning/multi-language-parser.ts";
export type { TreeSitterLanguageDefinition } from "./scanning/multi-language-parser.ts";

export { createOpenAIEmbeddingProvider } from "./embedding/openai-embedding-provider.ts";
export type { OpenAIEmbeddingConfig } from "./embedding/openai-embedding-provider.ts";

export { createSqliteStore } from "./indexing/sqlite-store.ts";

export { cosineSimilarity } from "./matching/similarity.ts";
export { findDuplicatePairs, clusterDuplicates } from "./matching/duplicate-finder.ts";
export type { DuplicatePairSearchOptions } from "./matching/duplicate-finder.ts";

export { formatReport } from "./output/json-formatter.ts";
export type { FormatInput } from "./output/json-formatter.ts";

export { runPipeline } from "./pipeline.ts";
export type { PipelineInput, PipelineProgress } from "./pipeline.ts";
