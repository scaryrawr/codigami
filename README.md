# Codigami

Find duplicate code using embedding similarity — not lexical matching.

Codigami parses your codebase into semantic units (functions, classes, methods), converts them to vector embeddings via any OpenAI-compatible API, then clusters units whose embeddings exceed a cosine similarity threshold. The result is a report of code that *means* the same thing, even if it *looks* different.

## How It Works

```
┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
│  Scanning  │────▶│  Embedding │────▶│  Indexing   │────▶│  Matching  │────▶│   Output   │
└────────────┘     └────────────┘     └────────────┘     └────────────┘     └────────────┘
 Walk files &       Convert source     Persist units      Cosine similarity   JSON report of
 parse into         to vectors via      & vectors in       + union-find        duplicate
 code units         embedding API       SQLite             clustering          clusters
```

### 1. Scanning

The scanner walks a directory tree (skipping `node_modules`, `.git`, and hidden dirs) and collects files matching the configured extensions (`.ts`, `.tsx`, `.js`, `.jsx` by default).

Each file is then parsed with [tree-sitter](https://tree-sitter.github.io/) to extract **code units** — the meaningful chunks that get compared:

- Function declarations
- Arrow functions / function expressions assigned to variables
- Class declarations
- Class method definitions

Each unit captures its file path, line range, name, type, and full source text.

### 2. Embedding

Code units are batched and sent to an OpenAI-compatible embeddings endpoint. By default, Codigami uses a local server running [Jina Code Embeddings](https://huggingface.co/jinaai/jina-embeddings-v2-base-code) (1.5B MLX variant), but any endpoint implementing the `/v1/embeddings` API works — including OpenAI directly.

Each unit's source code is converted to a high-dimensional vector that captures its *semantic meaning*, not just its syntax.

### 3. Indexing

Code units and their embedding vectors are stored in a local SQLite database (`.codigami/index.db` by default). This provides:

- Persistence across runs (re-scan only changed files in future versions)
- Fast retrieval of all unit/vector pairs for comparison
- WAL mode for safe concurrent reads

### 4. Matching

All pairs of embeddings are compared via **cosine similarity**. Pairs that meet or exceed the configured threshold (default: `0.8`) are flagged as duplicates.

Flagged pairs are then grouped into **clusters** using a union-find data structure — if A≈B and B≈C, all three end up in the same cluster, even if A and C weren't directly compared as similar.

### 5. Output

The final report is a JSON document containing:

```json
{
  "scannedFiles": 42,
  "totalUnits": 187,
  "threshold": 0.8,
  "timestamp": "2026-05-08T19:57:00.000Z",
  "duplicateClusters": [
    {
      "units": [
        { "filePath": "src/auth/validate.ts", "name": "validateToken", "startLine": 5, "endLine": 18, ... },
        { "filePath": "src/api/middleware.ts", "name": "checkAuth", "startLine": 12, "endLine": 27, ... }
      ],
      "pairs": [
        { "unitIdA": "a1b2c3...", "unitIdB": "d4e5f6...", "similarity": 0.92 }
      ]
    }
  ]
}
```

## Installation

```bash
npm install
```

## Usage

```bash
# Scan the current directory with defaults
npx codigami

# Scan a specific directory with a custom threshold
npx codigami --dir ./src --threshold 0.85

# Use a remote embedding endpoint
npx codigami --endpoint https://api.openai.com/v1 --model text-embedding-3-small

# Write report to a file instead of stdout
npx codigami --output report.json
```

### CLI Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--dir` | `-d` | Directory to scan | `.` |
| `--endpoint` | `-e` | OpenAI-compatible embedding endpoint | `http://localhost:14982/v1` |
| `--model` | `-m` | Embedding model name | `jina-code-embeddings-1.5b-mlx` |
| `--threshold` | `-t` | Similarity threshold (0.0–1.0) | `0.8` |
| `--db` | | SQLite database path | `<dir>/.codigami/index.db` |
| `--output` | `-o` | Write JSON report to file | stdout |
| `--help` | `-h` | Show help message | |

## Architecture

```
src/
├── cli.ts                          # CLI entry point & arg parsing
├── pipeline.ts                     # Orchestrates the full scan pipeline
├── types.ts                        # Shared interfaces & error types
├── index.ts                        # Public API exports
├── scanning/
│   ├── file-walker.ts              # Directory traversal & file discovery
│   └── typescript-parser.ts        # Tree-sitter based code unit extraction
├── embedding/
│   └── openai-embedding-provider.ts # OpenAI-compatible embedding client
├── indexing/
│   └── sqlite-store.ts             # SQLite persistence for units & vectors
├── matching/
│   ├── similarity.ts               # Cosine similarity computation
│   └── duplicate-finder.ts         # Pair detection & union-find clustering
└── output/
    └── json-formatter.ts           # Report formatting
```

### Design Principles

- **Dependency Injection** — All external concerns (embedding providers, file readers, index stores) are injected via interfaces, making testing trivial and providers swappable.
- **Streaming Pipeline** — Files are parsed and embedded in batches as they're discovered, keeping memory usage bounded regardless of codebase size.
- **Semantic over Lexical** — Detects duplicates that traditional tools miss: renamed variables, reordered parameters, different formatting, or alternate implementations of the same logic.

## Development

```bash
npm run typecheck   # Type-check with tsgo
npm run build       # Compile with tsgo
npm run test        # Run tests with Vitest
npm run test:watch  # Watch mode
npm run lint        # Lint with oxlint
npm run fmt         # Format with oxfmt
```

## License

MIT
