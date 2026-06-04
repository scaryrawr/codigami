---
name: codigami-validation
description: Choose and run the right validation path for Codigami changes.
disable-model-invocation: true
---

# Codigami Validation

Use this skill when validating local changes in this repository.

## Fast path

1. For one test file, run `bun run test test/path/to/file.test.ts`.
2. For type-only or API-shape changes, run `bun run typecheck`.
3. For formatting-only or docs-adjacent checks, run `bun run fmt:check`.

## Before committing

Run:

```bash
bun run typecheck
bun run test
```

Add `bun run lint` or `bun run fmt:check` when the changed files could violate lint or formatting rules.

## Notes

- Keep embedding providers and external services mocked in tests.
- If parser or extractor behavior changes, include parser-focused tests and verify incremental cache keys are updated.
- Do not validate by running the real CLI against a remote embedding endpoint unless the user explicitly asks.
