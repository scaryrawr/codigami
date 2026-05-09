# Codigami

**Code + Shinigami**

![death note delete](./assets/delete.gif)

Find duplicate code using embedding similarity — not lexical matching.

Codigami parses polyglot codebases into semantic units (functions, classes, methods, and language equivalents), embeds each unit with an OpenAI-compatible embeddings API, stores the results in SQLite, and reports clusters of units whose embedding cosine similarity is above a configurable threshold.

Totally vibe coded.

## How It Works

```text
┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
│  Scanning  │────▶│  Embedding │────▶│  Indexing  │────▶│  Matching  │────▶│   Output   │
└────────────┘     └────────────┘     └────────────┘     └────────────┘     └────────────┘
 Walk files &       Convert source     Persist units      Cosine similarity   JSON report of
 parse into         to vectors via      & vectors in       + union-find        duplicate
 code units         embedding API       SQLite             clustering          clusters
```

### 1. Scanning

The CLI walks the target directory and discovers files matching these extensions:

- TypeScript/JavaScript: `.ts`, `.tsx`, `.js`, `.jsx`
- Rust: `.rs`
- C#: `.cs`
- C++: `.cpp`, `.cc`, `.cxx`, `.c++`, `.hpp`, `.hh`, `.hxx`, `.h++`, `.h`
- C: `.c`
- Zig: `.zig`
- Go: `.go`
- Python: `.py`

The walker skips `node_modules`, `.git`, hidden files, and hidden directories.

Discovered files are parsed with [web-tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web) using language-specific tree-sitter grammars. The default multi-language parser loads a grammar on demand the first time a matching file extension is parsed. Codigami currently extracts semantic code units such as:

- TypeScript/JavaScript top-level and exported function/class declarations, top-level lexical arrow/function expressions, and class methods
- Rust `fn` items and `impl` blocks, including methods inside `impl` blocks
- C# classes/structs/records, methods, and constructors
- C function definitions
- C++ function definitions and class/struct specifiers, including inline method bodies
- Zig functions and struct declarations assigned to variables
- Go functions and methods
- Python functions, classes, and methods inside classes

Each unit includes:

- `id` — deterministic hash based on the file path and line range, with unit-level disambiguation when multiple nested units share the same line range
- `filePath`
- `startLine` / `endLine`
- `unitType`
- `name`
- `source`
- `language`

### 2. Incremental Change Detection

By default, the CLI uses the SQLite index as an incremental cache:

- file contents and the parser/extractor cache key are hashed with SHA-256
- unchanged files are skipped on later runs
- deleted files recorded in the hash table are pruned from the index
- changed files are re-parsed and re-embedded
- existing units for a changed file are replaced only after all new embeddings for that file are available

Use `--full` to ignore file hashes and process all currently discovered files. This reprocesses discovered files and replaces their indexed units, but it does not clear the database first or prune files that no longer exist; delete `.codigami/index.db` or use a fresh `--db` path if you want a completely clean index. Built-in parser/extractor changes invalidate hashes automatically through the parser cache key.

### 3. Embedding

Code units are embedded in batches of 64 by an `EmbeddingProvider`. The built-in provider uses the official `openai` SDK against an OpenAI-compatible `/v1/embeddings` endpoint.

CLI defaults:

- endpoint: `http://localhost:14982/v1`
- model: `jina-code-embeddings-1.5b-mlx`

Codigami does not start or manage an embedding server. The default assumes you already have a local OpenAI-compatible embedding service running at that endpoint. The CLI passes a placeholder API key (`no-key`), which works for many local servers; for providers that require a real key, use the library API and pass `apiKey` to `createOpenAIEmbeddingProvider`, or inject your own `EmbeddingProvider`.

### 4. Indexing

Code units and embeddings are persisted in SQLite (`.codigami/index.db` by default). The database contains:

- `code_units` — parsed unit metadata and source text
- `embeddings` — vectors stored as `Float32Array` blobs
- `file_hashes` — content/parser cache hashes when incremental mode is active

SQLite is configured with WAL mode and foreign keys enabled. Embeddings are deleted automatically when their code unit is deleted.

### 5. Matching

Codigami compares indexed embeddings with cosine similarity and returns pairs whose score is greater than or equal to the configured threshold.

For small indexes, matching is exhaustive. For larger indexes, Codigami uses deterministic signature buckets to bound candidate comparisons before applying the exact cosine threshold. Duplicate pairs are then grouped into clusters with union-find, so connected matches like `A≈B` and `B≈C` become one cluster.

Default matching behavior:

- exhaustive all-pairs search up to 1,024 entries
- bounded candidate search above that size
- maximum 64 candidates per unit in bounded mode
- threshold default: `0.8`

### 6. Output

The CLI prints a JSON report to stdout, or writes it to `--output` if provided.

```json
{
  "scannedFiles": 42,
  "totalUnits": 187,
  "threshold": 0.8,
  "timestamp": "2026-05-08T19:57:00.000Z",
  "duplicateClusters": [
    {
      "units": [
        {
          "id": "a1b2c3d4e5f6a7b8",
          "filePath": "src/auth/validate.ts",
          "startLine": 5,
          "endLine": 18,
          "unitType": "function_declaration",
          "name": "validateToken",
          "source": "function validateToken(...) { ... }",
          "language": "typescript"
        }
      ],
      "pairs": [
        {
          "unitIdA": "a1b2c3d4e5f6a7b8",
          "unitIdB": "d4e5f6a7b8c9d0e1",
          "similarity": 0.92
        }
      ]
    }
  ]
}
```

`scannedFiles` is the number of files discovered for the run. `totalUnits` is the number of units parsed and embedded during that run; on incremental runs, unchanged files can be skipped, while matching still uses the current contents of the SQLite index.

## Installation

From this repository:

```bash
npm install
npm run build
```

## Usage

```bash
# Scan the current directory with defaults
npx codigami

# Scan a specific directory with a custom threshold
npx codigami --dir ./src --threshold 0.85

# Use a different OpenAI-compatible embedding endpoint/model
npx codigami --endpoint http://localhost:14982/v1 --model jina-code-embeddings-1.5b-mlx

# Write report to a file instead of stdout
npx codigami --output report.json

# Ignore file hashes and reprocess discovered files
npx codigami --full

# Use a custom SQLite database path
npx codigami --db /tmp/codigami-index.db
```

### CLI Options

| Option        | Short | Description                                                      | Default                         |
| ------------- | ----- | ---------------------------------------------------------------- | ------------------------------- |
| `--dir`       | `-d`  | Directory to scan                                                | `.`                             |
| `--endpoint`  | `-e`  | OpenAI-compatible embedding endpoint                             | `http://localhost:14982/v1`     |
| `--model`     | `-m`  | Embedding model name                                             | `jina-code-embeddings-1.5b-mlx` |
| `--threshold` | `-t`  | Similarity threshold, from `0.0` to `1.0`                        | `0.8`                           |
| `--db`        |       | SQLite database path                                             | `<dir>/.codigami/index.db`      |
| `--full`      |       | Process all discovered files instead of using stored file hashes | `false`                         |
| `--output`    | `-o`  | Write JSON report to a file                                      | stdout                          |
| `--help`      | `-h`  | Show help message                                                |                                 |

## Library API

The CLI is a thin composition layer around injectable interfaces. You can use the library directly with custom parsers, stores, file readers, or embedding providers.

```ts
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Parser } from "web-tree-sitter";
import {
  createDefaultLanguageParser,
  createOpenAIEmbeddingProvider,
  createSqliteStore,
  runPipeline,
  walkDirectory,
} from "codigami";

const directory = process.cwd();
const dbPath = `${directory}/.codigami/index.db`;
await mkdir(dirname(dbPath), { recursive: true });

await Parser.init();

const parser = await createDefaultLanguageParser();
const files = await walkDirectory(directory, [...parser.extensions]);
const embeddingProvider = createOpenAIEmbeddingProvider({
  baseURL: "http://localhost:14982/v1",
  model: "jina-code-embeddings-1.5b-mlx",
});
const store = createSqliteStore(dbPath);

try {
  const report = await runPipeline({
    files,
    parser,
    embeddingProvider,
    store,
    threshold: 0.8,
  });

  console.log(JSON.stringify(report, null, 2));
} finally {
  store.close();
}
```

Core interfaces are intentionally narrow:

- `LanguageParser` parses source text into `CodeUnit[]` and can expose a parser/extractor `cacheKey` for incremental invalidation
- `EmbeddingProvider` converts source strings into embedding vectors
- `IndexStore` persists units and embeddings

The pipeline also supports a file-hash store for incremental processing; the CLI wires the SQLite-backed implementation by default. Without a `hashStore`, `runPipeline` processes every file passed to it. Useful advanced options include `embeddingBatchSize`, `parseConcurrency`, `readFile`, and `onProgress`.

## Architecture

```text
src/
├── cli.ts                              # CLI entry point, argument parsing, default wiring
├── pipeline.ts                         # Orchestrates discovery results, parsing, embedding, indexing, matching, output
├── types.ts                            # Shared interfaces, report shapes, CodigamiError, unit ID helper
├── index.ts                            # Public API exports
├── scanning/
│   ├── file-walker.ts                  # Directory traversal and file discovery
│   ├── file-change-detector.ts         # SHA-256 file hashing and change/deletion detection
│   ├── multi-language-parser.ts        # Default web-tree-sitter parser registry for supported languages
│   ├── tree-sitter-unit-extractor.ts   # Rule-based unit extraction helpers for tree-sitter nodes
│   ├── typescript-parser-loader.ts     # Lazy TypeScript/TSX grammar loading
│   ├── typescript-parser.ts            # web-tree-sitter TypeScript parser adapter
│   ├── typescript-unit-extractor.ts    # TypeScript/JavaScript unit extraction
│   ├── parser-pool.ts                  # Optional worker-thread parser pool
│   ├── parser-worker.ts                # Worker implementation for parser pool
│   └── threaded-parser.ts              # LanguageParser wrapper around parser pool
├── embedding/
│   └── openai-embedding-provider.ts    # OpenAI-compatible embedding client
├── indexing/
│   ├── sqlite-store.ts                 # SQLite persistence for units and vectors
│   └── sqlite-hash-store.ts            # SQLite-backed file hash store
├── matching/
│   ├── similarity.ts                   # Cosine similarity
│   └── duplicate-finder.ts             # Pair detection, bounded retrieval, union-find clustering
└── output/
    └── json-formatter.ts               # Report formatting
```

### Design Principles

- **Dependency Injection** — embedding providers, parsers, stores, and file readers are passed in through interfaces.
- **Incremental by Default** — unchanged files are skipped through persisted file hashes, while changed files are replaced safely after embeddings are ready.
- **Streaming Batches** — files are parsed and embeddings are requested in batches so all source units do not need to be embedded in one request.
- **Semantic over Lexical** — embeddings can surface similar intent even when syntax, names, or formatting differ.
- **Typed Errors** — expected operational failures are wrapped in `CodigamiError` with context.

## Development

```bash
npm run typecheck   # Type-check with tsgo
npm run build       # Compile with tsgo
npm run test        # Run tests with Vitest
npm run test:watch  # Watch mode
npm run lint        # Lint with oxlint
npm run lint:fix    # Lint and auto-fix where possible
npm run fmt         # Format with oxfmt
npm run fmt:check   # Check formatting
```

Run `npm run typecheck` and `npm run test` before committing.

## License

MIT
