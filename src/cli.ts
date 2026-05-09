import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { Parser } from "web-tree-sitter";
import Database from "better-sqlite3";
import { walkDirectory } from "./scanning/file-walker.ts";
import { createDefaultLanguageParser } from "./scanning/multi-language-parser.ts";
import { createOpenAIEmbeddingProvider } from "./embedding/openai-embedding-provider.ts";
import { createSqliteStoreFromDatabase } from "./indexing/sqlite-store.ts";
import { createSqliteHashStore } from "./indexing/sqlite-hash-store.ts";
import { runPipeline } from "./pipeline.ts";
import { CodigamiError, type FileHashStore, type IndexStore } from "./types.ts";

const DEFAULT_ENDPOINT = "http://localhost:14982/v1";
const DEFAULT_MODEL = "jina-code-embeddings-1.5b-mlx";
const DEFAULT_THRESHOLD = 0.8;
const parseThreshold = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  const threshold = Number(trimmed);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) return undefined;

  return threshold;
};

export const main = async (argv: string[] = process.argv.slice(2)): Promise<void> => {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: "string", short: "d", default: "." },
      endpoint: { type: "string", short: "e", default: DEFAULT_ENDPOINT },
      model: { type: "string", short: "m", default: DEFAULT_MODEL },
      threshold: { type: "string", short: "t", default: String(DEFAULT_THRESHOLD) },
      db: { type: "string", default: "" },
      output: { type: "string", short: "o", default: "" },
      full: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`codigami — find duplicate code via embeddings

Usage: codigami [options]

Options:
  -d, --dir <path>        Directory to scan (default: ".")
  -e, --endpoint <url>    OpenAI-compatible embedding endpoint
  -m, --model <name>      Embedding model name
  -t, --threshold <n>     Similarity threshold 0.0-1.0 (default: ${DEFAULT_THRESHOLD})
      --db <path>         SQLite database path (default: <dir>/.codigami/index.db)
      --full              Force full re-index (ignore file hashes)
  -o, --output <path>     Write JSON report to file (default: stdout)
  -h, --help              Show this help message`);
    return;
  }

  const directory = resolve(values.dir!);
  const threshold = parseThreshold(values.threshold!);
  if (threshold === undefined) {
    console.error(
      `Error: threshold must be a number between 0.0 and 1.0, got: ${JSON.stringify(values.threshold)}`,
    );
    process.exitCode = 1;
    return;
  }

  const dbPath = values.db || resolve(directory, ".codigami", "index.db");

  // Ensure .codigami directory exists
  const dbDir = resolve(dbPath, "..");
  await mkdir(dbDir, { recursive: true });

  // Initialize tree-sitter
  await Parser.init();

  const parser = await createDefaultLanguageParser();
  const embeddingProvider = createOpenAIEmbeddingProvider({
    baseURL: values.endpoint!,
    model: values.model!,
  });

  let store: IndexStore | undefined;
  let database: InstanceType<typeof Database> | undefined;
  let hashStore: FileHashStore | undefined;

  try {
    database = new Database(dbPath);
    store = createSqliteStoreFromDatabase(database);
    if (!values.full) {
      hashStore = createSqliteHashStore(database);
    }

    const files = await walkDirectory(directory, [...parser.extensions]);
    console.error(`Found ${files.length} file(s) to scan...`);

    const report = await runPipeline({
      files,
      parser,
      embeddingProvider,
      store,
      threshold,
      hashStore,
      onProgress: (progress) => {
        switch (progress.stage) {
          case "parsing":
            console.error(`  Parsing [${progress.current}/${progress.total}] ${progress.path}`);
            break;
          case "embedding":
            console.error(
              `  Embedding batch ${progress.batchIndex} (${progress.unitsProcessed}/${progress.totalUnits} units)`,
            );
            break;
          case "matching":
            console.error(`  Finding duplicates among ${progress.totalUnits} unit(s)...`);
            break;
          case "skipped":
            console.error(`  Skipped ${progress.count}/${progress.total} unchanged file(s)`);
            break;
          case "pruning":
            console.error(`  Pruned ${progress.count} deleted file(s) from index`);
            break;
        }
      },
    });

    const json = JSON.stringify(report, null, 2);

    if (values.output) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(values.output, json, "utf-8");
      console.error(`Report written to ${values.output}`);
    } else {
      console.log(json);
    }

    const clusterCount = report.duplicateClusters.length;
    console.error(
      `Scanned ${report.scannedFiles} file(s), ${report.totalUnits} unit(s), found ${clusterCount} duplicate cluster(s).`,
    );
  } catch (error) {
    if (error instanceof CodigamiError) {
      console.error(`Error: ${error.message}`);
      if (error.context) {
        for (const [key, value] of Object.entries(error.context)) {
          console.error(`  ${key}: ${String(value)}`);
        }
      }
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exitCode = 1;
  } finally {
    hashStore?.close();
    store?.close();
    if (database?.open) {
      database.close();
    }
  }
};
