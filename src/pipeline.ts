import { readFile as fsReadFile } from "node:fs/promises";
import type { DiscoveredFile } from "./scanning/file-walker.ts";
import { detectFileChanges, hashContent } from "./scanning/file-change-detector.ts";
import { clusterDuplicates, findDuplicatePairs } from "./matching/duplicate-finder.ts";
import { formatReport } from "./output/json-formatter.ts";
import {
  CodigamiError,
  type CodeUnit,
  type ComparisonLevel,
  type DuplicateReport,
  type EmbeddingProvider,
  type FileHashStore,
  type IndexStore,
  type LanguageParser,
  type StoredEmbedding,
  makeUnitId,
} from "./types.ts";

export type PipelineProgress =
  | { stage: "parsing"; current: number; total: number; path: string }
  | { stage: "embedding"; batchIndex: number; unitsProcessed: number; totalUnits: number }
  | { stage: "matching"; totalUnits: number }
  | { stage: "skipped"; count: number; total: number }
  | { stage: "pruning"; count: number };

export interface PipelineInput {
  files: DiscoveredFile[];
  parser: LanguageParser;
  embeddingProvider: EmbeddingProvider;
  store: IndexStore;
  threshold: number;
  hashStore?: FileHashStore;
  readFile?: (path: string) => Promise<string>;
  embeddingBatchSize?: number;
  parseConcurrency?: number;
  comparisonLevels?: readonly ComparisonLevel[];
  onProgress?: (progress: PipelineProgress) => void;
}

interface ParsedFileState {
  filePath: string;
  sourceHash: string | undefined;
  units: CodeUnit[];
  embeddings: Map<string, number[]>;
  remainingEmbeddings: number;
  persisted: boolean;
}

interface BufferedUnit {
  state: ParsedFileState;
  unit: CodeUnit;
}

const DEFAULT_COMPARISON_LEVELS: readonly ComparisonLevel[] = ["function"];

const FUNCTION_UNIT_TYPES = new Set([
  "arrow_function",
  "constructor_declaration",
  "function",
  "function_declaration",
  "function_definition",
  "function_expression",
  "function_item",
  "method_declaration",
  "method_definition",
]);

const CLASS_UNIT_TYPES = new Set([
  "class_declaration",
  "class_definition",
  "class_specifier",
  "impl_item",
  "record_declaration",
  "struct_declaration",
  "struct_specifier",
]);

const describeUnknownError = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const normalizeComparisonLevels = (
  levels: readonly ComparisonLevel[] | undefined,
): ComparisonLevel[] => {
  const normalized = Array.from(new Set(levels ?? DEFAULT_COMPARISON_LEVELS));
  if (normalized.length === 0) {
    throw new CodigamiError("comparisonLevels must include at least one level");
  }

  return normalized;
};

const comparisonLevelsCacheKey = (levels: readonly ComparisonLevel[]): string => {
  const sorted = [...levels].sort();
  return `comparison-levels:${sorted.join(",")}`;
};

const pipelineCacheKey = (
  parserCacheKey: string | undefined,
  levels: readonly ComparisonLevel[],
): string => {
  const levelCacheKey = comparisonLevelsCacheKey(levels);
  return parserCacheKey ? `${parserCacheKey}|${levelCacheKey}` : levelCacheKey;
};

const includesLevel = (levels: ReadonlySet<ComparisonLevel>, unit: CodeUnit): boolean => {
  if (levels.has("function") && FUNCTION_UNIT_TYPES.has(unit.unitType)) return true;
  if (levels.has("class") && CLASS_UNIT_TYPES.has(unit.unitType)) return true;
  return false;
};

const lineCount = (source: string): number => source.split(/\r\n|\r|\n/).length;

const createFileUnit = (filePath: string, source: string, language: string): CodeUnit => ({
  id: makeUnitId(`${filePath}#file`, 1, lineCount(source)),
  filePath,
  startLine: 1,
  endLine: lineCount(source),
  unitType: "file",
  name: filePath,
  source,
  language,
});

const selectComparisonUnits = (
  parsedUnits: CodeUnit[],
  filePath: string,
  source: string,
  parserLanguage: string,
  levels: readonly ComparisonLevel[],
): CodeUnit[] => {
  const levelSet = new Set(levels);
  const units = parsedUnits.filter((unit) => includesLevel(levelSet, unit));

  if (levelSet.has("file")) {
    units.push(createFileUnit(filePath, source, parsedUnits[0]?.language ?? parserLanguage));
  }

  return units;
};

export const runPipeline = async (input: PipelineInput): Promise<DuplicateReport> => {
  const {
    files,
    parser,
    embeddingProvider,
    store,
    threshold,
    hashStore,
    readFile = (path: string) => fsReadFile(path, "utf-8"),
    embeddingBatchSize = 64,
    parseConcurrency = 1,
    comparisonLevels,
    onProgress,
  } = input;
  const normalizedComparisonLevels = normalizeComparisonLevels(comparisonLevels);
  const cacheKey = pipelineCacheKey(parser.cacheKey, normalizedComparisonLevels);

  if (!Number.isInteger(embeddingBatchSize) || embeddingBatchSize <= 0) {
    throw new CodigamiError("embeddingBatchSize must be a positive integer", {
      embeddingBatchSize,
    });
  }

  if (!Number.isInteger(parseConcurrency) || parseConcurrency <= 0) {
    throw new CodigamiError("parseConcurrency must be a positive integer", { parseConcurrency });
  }

  // Determine which files need processing
  let filesToProcess: DiscoveredFile[];
  if (hashStore) {
    const changes = await detectFileChanges({
      files,
      hashStore,
      readFile,
      cacheKey,
    });
    filesToProcess = changes.changed;

    // Prune deleted files from index and hash store
    if (changes.deleted.length > 0) {
      store.deleteByFilePaths(changes.deleted);
      hashStore.removeFiles(changes.deleted);
      onProgress?.({ stage: "pruning", count: changes.deleted.length });
    }

    const skippedCount = files.length - filesToProcess.length;
    if (skippedCount > 0) {
      onProgress?.({ stage: "skipped", count: skippedCount, total: files.length });
    }
  } else {
    filesToProcess = files;
  }

  let totalUnits = 0;
  let embeddedUnits = 0;
  let batchIndex = 0;
  let buffer: BufferedUnit[] = [];

  const flushBuffer = async () => {
    while (buffer.length >= embeddingBatchSize) {
      const batch = buffer.splice(0, embeddingBatchSize);
      await embedAndStore(batch);
    }
  };

  const persistProcessedFile = (state: ParsedFileState): void => {
    if (state.persisted) return;
    if (state.remainingEmbeddings !== 0) {
      throw new CodigamiError("Cannot persist file before all embeddings are available", {
        filePath: state.filePath,
        remainingEmbeddings: state.remainingEmbeddings,
      });
    }

    const entries: StoredEmbedding[] = state.units.map((unit) => {
      const embedding = state.embeddings.get(unit.id);
      if (embedding === undefined) {
        throw new CodigamiError("Missing embedding for code unit", {
          filePath: state.filePath,
          unitId: unit.id,
        });
      }

      return { unitId: unit.id, embedding };
    });

    store.replaceFileUnitsWithEmbeddings([state.filePath], state.units, entries);

    if (hashStore) {
      if (state.sourceHash === undefined) {
        throw new CodigamiError("Missing content hash for processed file", {
          filePath: state.filePath,
        });
      }
      hashStore.setHash(state.filePath, state.sourceHash);
    }

    state.persisted = true;
  };

  const embedAndStore = async (items: BufferedUnit[]) => {
    const texts = items.map((item) => item.unit.source);
    let embeddings: number[][];
    try {
      embeddings = await embeddingProvider.embed(texts);
    } catch (error) {
      if (error instanceof CodigamiError) throw error;
      throw new CodigamiError("Embedding provider failed", {
        cause: describeUnknownError(error),
        unitCount: texts.length,
      });
    }

    if (embeddings.length !== texts.length) {
      throw new CodigamiError("Embedding provider returned unexpected vector count", {
        expected: texts.length,
        received: embeddings.length,
      });
    }

    const affectedStates = new Set<ParsedFileState>();
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const embedding = embeddings[idx];
      if (item === undefined || embedding === undefined) {
        throw new CodigamiError("Embedding provider returned unexpected vector count", {
          expected: texts.length,
          received: embeddings.length,
        });
      }

      item.state.embeddings.set(item.unit.id, embedding);
      item.state.remainingEmbeddings--;
      affectedStates.add(item.state);
    }

    for (const state of affectedStates) {
      if (state.remainingEmbeddings === 0) {
        persistProcessedFile(state);
      }
    }

    embeddedUnits += items.length;
    batchIndex++;
    onProgress?.({ stage: "embedding", batchIndex, unitsProcessed: embeddedUnits, totalUnits });
  };

  // 1. Stream: parse files and embed in batches
  for (let i = 0; i < filesToProcess.length; i += parseConcurrency) {
    const batch = filesToProcess.slice(i, Math.min(i + parseConcurrency, filesToProcess.length));

    const results = await Promise.all(
      batch.map(async (file, batchIdx) => {
        const fileIndex = i + batchIdx;
        onProgress?.({
          stage: "parsing",
          current: fileIndex + 1,
          total: filesToProcess.length,
          path: file.relativePath,
        });

        const source = await readFile(file.absolutePath);
        const parsedUnits = await parser.parse(file.relativePath, source);
        const units = selectComparisonUnits(
          parsedUnits,
          file.relativePath,
          source,
          parser.language,
          normalizedComparisonLevels,
        );
        return { file, source, units };
      }),
    );

    for (const { file, source, units } of results) {
      const state: ParsedFileState = {
        filePath: file.relativePath,
        sourceHash: hashStore ? hashContent(source, cacheKey) : undefined,
        units,
        embeddings: new Map(),
        remainingEmbeddings: units.length,
        persisted: false,
      };

      totalUnits += units.length;

      if (units.length === 0) {
        persistProcessedFile(state);
      } else {
        buffer.push(...units.map((unit) => ({ state, unit })));
      }
    }

    await flushBuffer();
  }

  // Flush remaining units
  if (buffer.length > 0) {
    await embedAndStore(buffer);
    buffer = [];
  }

  // 2. Find duplicates
  onProgress?.({ stage: "matching", totalUnits });
  const indexed = store.getAllWithEmbeddings();
  const pairs = findDuplicatePairs(indexed, threshold);
  const clusters = clusterDuplicates(pairs);

  // 3. Format report
  return formatReport({
    scannedFiles: files.length,
    totalUnits,
    clusters,
    threshold,
  });
};
