import { readFile as fsReadFile } from "node:fs/promises";
import type { DiscoveredFile } from "./scanning/file-walker.ts";
import { detectFileChanges, hashContent } from "./scanning/file-change-detector.ts";
import { clusterDuplicates, findDuplicatePairs } from "./matching/duplicate-finder.ts";
import { formatReport } from "./output/json-formatter.ts";
import { CodigamiError, type CodeUnit, type DuplicateReport, type EmbeddingProvider, type FileHashStore, type IndexStore, type LanguageParser } from "./types.ts";

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
  onProgress?: (progress: PipelineProgress) => void;
}

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
    onProgress,
  } = input;

  if (!Number.isInteger(embeddingBatchSize) || embeddingBatchSize <= 0) {
    throw new CodigamiError("embeddingBatchSize must be a positive integer", { embeddingBatchSize });
  }

  if (!Number.isInteger(parseConcurrency) || parseConcurrency <= 0) {
    throw new CodigamiError("parseConcurrency must be a positive integer", { parseConcurrency });
  }

  // Determine which files need processing
  let filesToProcess: DiscoveredFile[];
  if (hashStore) {
    const changes = await detectFileChanges({ files, hashStore, readFile });
    filesToProcess = changes.changed;

    // Prune deleted files from index and hash store
    if (changes.deleted.length > 0) {
      store.deleteByFilePaths(changes.deleted);
      hashStore.removeFiles(changes.deleted);
      onProgress?.({ stage: "pruning", count: changes.deleted.length });
    }

    // Prune changed files from index (will be re-indexed below)
    const changedPaths = filesToProcess.map((f) => f.relativePath);
    if (changedPaths.length > 0) {
      store.deleteByFilePaths(changedPaths);
    }

    const skippedCount = files.length - filesToProcess.length;
    if (skippedCount > 0) {
      onProgress?.({ stage: "skipped", count: skippedCount, total: files.length });
    }
  } else {
    filesToProcess = files;
  }

  let totalUnits = 0;
  let batchIndex = 0;
  let buffer: CodeUnit[] = [];

  const flushBuffer = async () => {
    while (buffer.length >= embeddingBatchSize) {
      const batch = buffer.splice(0, embeddingBatchSize);
      await embedAndStore(batch);
    }
  };

  const embedAndStore = async (units: CodeUnit[]) => {
    store.upsertUnits(units);

    const texts = units.map((u) => u.source);
    const embeddings = await embeddingProvider.embed(texts);

    if (embeddings.length !== texts.length) {
      throw new CodigamiError("Embedding provider returned unexpected vector count", {
        expected: texts.length,
        received: embeddings.length,
      });
    }

    const entries = units.map((unit, idx) => ({
      unitId: unit.id,
      embedding: embeddings[idx],
    }));
    store.storeEmbeddings(entries);

    batchIndex++;
    onProgress?.({ stage: "embedding", batchIndex, unitsProcessed: totalUnits - buffer.length, totalUnits });
  };

  // 1. Stream: parse files and embed in batches
  for (let i = 0; i < filesToProcess.length; i += parseConcurrency) {
    const batch = filesToProcess.slice(i, Math.min(i + parseConcurrency, filesToProcess.length));

    const results = await Promise.all(
      batch.map(async (file, batchIdx) => {
        const fileIndex = i + batchIdx;
        onProgress?.({ stage: "parsing", current: fileIndex + 1, total: filesToProcess.length, path: file.relativePath });

        const source = await readFile(file.absolutePath);
        const units = await parser.parse(file.relativePath, source);
        return { file, source, units };
      }),
    );

    for (const { file, source, units } of results) {
      buffer.push(...units);
      totalUnits += units.length;

      if (hashStore) {
        hashStore.setHash(file.relativePath, hashContent(source));
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
