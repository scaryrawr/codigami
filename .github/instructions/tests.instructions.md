---
name: test-conventions
description: Codigami Vitest conventions
applyTo: "test/**/*.ts"
---

# Test Conventions

Use Vitest `describe` / `it` / `expect` APIs and import `vi` only when mocks are needed.

Keep tests deterministic: mock embedding providers and stores, use temporary directories for filesystem behavior, and never call real embedding endpoints.

Prefer public behavior assertions over private implementation details. It is okay to assert important interaction boundaries, such as avoiding an embedding call for empty input or skipped unchanged files.

For parser fixtures, build multiline source with arrays joined by `"\n"` and initialize `web-tree-sitter` in `beforeAll` before creating parsers.
