import { createHash } from "node:crypto";

// --- Scanning ---

export interface CodeUnit {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  unitType: string;
  name: string | null;
  source: string;
  language: string;
}

export type ComparisonLevel = "function" | "class" | "file";

export const COMPARISON_LEVELS = [
  "function",
  "class",
  "file",
] as const satisfies readonly ComparisonLevel[];

export const DEFAULT_COMPARISON_LEVELS = ["function"] as const satisfies readonly ComparisonLevel[];

export interface LanguageParser {
  readonly language: string;
  readonly extensions: readonly string[];
  /**
   * Versioned parser/extractor signature used to invalidate persisted file hashes
   * when parsing semantics change without source file changes.
   */
  readonly cacheKey?: string;
  parse(filePath: string, source: string): Promise<CodeUnit[]>;
}

// --- Embedding ---

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

// --- Indexing ---

export interface StoredEmbedding {
  unitId: string;
  embedding: number[];
}

export interface IndexStore {
  upsertUnits(units: CodeUnit[]): void;
  storeEmbeddings(entries: StoredEmbedding[]): void;
  replaceFileUnitsWithEmbeddings(
    filePaths: string[],
    units: CodeUnit[],
    entries: StoredEmbedding[],
  ): void;
  getAllWithEmbeddings(): { unit: CodeUnit; embedding: number[] }[];
  deleteByFilePaths(filePaths: string[]): void;
  clear(): void;
  close(): void;
}

// --- File Hashing ---

export interface FileHashStore {
  getHashes(): Map<string, string>;
  setHash(filePath: string, hash: string): void;
  removeFiles(filePaths: string[]): void;
  close(): void;
}

// --- Matching ---

export interface DuplicatePair {
  unitA: CodeUnit;
  unitB: CodeUnit;
  similarity: number;
}

export interface DuplicateCluster {
  units: CodeUnit[];
  pairs: { unitIdA: string; unitIdB: string; similarity: number }[];
}

// --- Output ---

export interface DuplicateReport {
  scannedFiles: number;
  totalUnits: number;
  duplicateClusters: DuplicateCluster[];
  threshold: number;
  timestamp: string;
}

// --- Pipeline ---

export interface PipelineConfig {
  directory: string;
  embeddingEndpoint: string;
  embeddingModel: string;
  similarityThreshold: number;
  dbPath: string;
  extensions?: string[];
  comparisonLevels?: ComparisonLevel[];
}

// --- Errors ---

export class CodigamiError extends Error {
  readonly context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "CodigamiError";
    this.context = context;
  }
}

// --- Utilities ---

export const makeUnitId = (filePath: string, startLine: number, endLine: number): string => {
  const hash = createHash("sha256");
  hash.update(`${filePath}:${startLine}:${endLine}`);
  return hash.digest("hex").slice(0, 16);
};
