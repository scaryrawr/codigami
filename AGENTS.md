# Codigami — Shared Instructions

Embeddings-based tool for identifying semantically and intent-equivalent duplicate code across a codebase.

## Commands

```bash
npm run typecheck   # tsgo --noEmit
npm run build       # tsgo
npm run test        # vitest run
npm run test:watch  # vitest
npm run lint        # oxlint .
npm run lint:fix    # oxlint . --fix
npm run fmt         # oxfmt .
npm run fmt:check   # oxfmt . --check
```

Run `typecheck` + `test` before committing. Use `fmt:check` for CI-style validation.

## Architecture

The project is a library that scans codebases and surfaces duplicate code clusters identified by embedding similarity, not lexical matching.

Core modules (target structure):

| Module | Responsibility |
|---|---|
| `scanning` | File discovery, chunking, and source extraction |
| `embedding` | Text → embedding conversion (provider abstraction) |
| `indexing` | Build and persist the similarity index |
| `matching` | Query the index, compute similarity, surface results |
| `output` | Format and render findings (CLI, JSON, etc.) |

Keep each module focused on a single responsibility. Prefer narrow interfaces and dependency injection over direct imports between modules.

## TDD

- **Write the test first.** Every feature, utility, or module starts with a failing test.
- **Keep tests fast and deterministic.** Mock external calls (embedding providers, file I/O) in unit tests; reserve integration tests for end-to-end scanning flows.
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
- **File naming** — kebab-case for modules (e.g., `embedding-provider.ts`), PascalCase for interfaces and types.
- **Error handling** — throw typed errors (`CodigamiError`) with a message and optional context; never swallow errors silently.
- **Public API surface** — only export what the public consumer needs; keep internals `private` or unexported.

## Safety

- **Never embed secrets.** API keys and tokens belong in environment variables, never in code or tests.
- **Rate-limit external calls.** Embedding providers are remote; always add backoff and circuit-breaking in production wiring.
- **Respect file permissions.** Scanning should fail gracefully on unreadable files, never crash the run.
