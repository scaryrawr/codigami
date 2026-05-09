# Codigami — Shared Instructions

Embeddings-based tool for identifying semantically and intent-equivalent duplicate code across a codebase.

## Commands

```bash
npm install         # install dependencies
npm run typecheck   # tsgo --noEmit
npm run build       # tsgo
npm run test        # vitest run
npm run test:watch  # vitest
npm run lint        # oxlint .
npm run lint:fix    # oxlint . --fix
npm run fmt         # oxfmt .
npm run fmt:check   # oxfmt . --check
```

Run `typecheck` + `test` before committing. Use `fmt:check` for CI-style validation. For narrow checks, run a single Vitest file with `npm run test -- test/path/to/file.test.ts`.

## Architecture

The project is a TypeScript ESM library and CLI that scans codebases and surfaces duplicate code clusters identified by embedding similarity, not lexical matching.

Core modules:

| Module            | Responsibility                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`      | CLI argument parsing, default wiring, progress output, lifecycle cleanup                                |
| `src/pipeline.ts` | Orchestrates discovery results, parsing, batching, embedding, indexing, matching, and report formatting |
| `src/types.ts`    | Shared public interfaces and `CodigamiError`                                                            |
| `src/scanning`    | File discovery, file hashing, tree-sitter parsing, and optional worker-thread parser pool               |
| `src/embedding`   | OpenAI-compatible embedding provider abstraction                                                        |
| `src/indexing`    | SQLite stores for code units, embeddings, and file hashes                                               |
| `src/matching`    | Cosine similarity, duplicate pair detection, and union-find clustering                                  |
| `src/output`      | JSON report formatting                                                                                  |

Keep each module focused on one responsibility. Prefer narrow interfaces and dependency injection over direct imports between modules; the CLI is the main composition root for concrete providers and stores. The package publishes from `dist/`; edit `src/` and let `npm run build` generate output.

## TDD

- **Write the test first.** Every feature, utility, or module starts with a failing test.
- **Keep tests fast and deterministic.** Mock external calls, embedding providers, and file I/O in unit tests; use temporary directories for filesystem behavior.
- **Prefer `describe` / `it` with Vitest.** Use `expect` with matchers; avoid `assert` imports.
- **Test behavior, not implementation.** Assert on public API outcomes, not internal state or exact call counts.
- **Edge cases first.** Null sources, empty chunks, missing embeddings, and malformed files should be tested before happy paths.

## Inversion of Control

- **Inject dependencies, don't import them.** Embedding providers, file readers, and index backends should be passed via function parameters or constructor args.
- **Define narrow interfaces.** Each external concern (e.g., `EmbeddingProvider`, `IndexStore`, `FileReader`) gets a minimal interface; implementations are wired at the top level.
- **No hidden globals.** Avoid module-level singletons or implicit state. Every dependency chain should be traceable from the entry point.
- **Reasoning:** This makes testing trivial (swap in mocks), enables swapping providers (OpenAI → local models), and keeps modules independently verifiable.

## Conventions

- **TypeScript strict mode** — no `any`, use `unknown` for untyped input, prefer `as` casts only at boundaries.
- **Named exports** — avoid default exports; use `export const` and `export interface`.
- **ESM imports** — use explicit `.ts` extensions for local source imports, matching the current `NodeNext` setup.
- **File naming** — kebab-case for modules (e.g., `embedding-provider.ts`), PascalCase for interfaces and types.
- **Error handling** — throw typed errors (`CodigamiError`) with a message and optional context; never swallow errors silently.
- **Public API surface** — expose consumer-facing APIs from `src/index.ts`; keep internals unexported unless tests or downstream users need them.
- **Parser cache keys** — when parser or extractor semantics change, update the relevant `cacheKey` constant so incremental scans reprocess affected files.

## Safety

- **Never embed secrets.** API keys and tokens belong in environment variables, never in code or tests.
- **External embedding calls are expensive and remote.** Batch intentionally, keep unit tests mocked, and surface provider failures as `CodigamiError`.
- **Respect file permissions.** Scanning should fail with useful typed errors on unreadable files; do not hide failures with silent skips.
- **SQLite indexes are generated artifacts.** Do not commit `.codigami/index.db` or other scan outputs unless explicitly requested.
