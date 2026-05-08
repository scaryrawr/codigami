# Copilot Instructions

Use the root `AGENTS.md` as the shared source of truth for this repository. Read it first, then apply any nearer nested `AGENTS.md` files if they are added later.

Keep this file Copilot-specific: do not duplicate repo-wide architecture, commands, or conventions here. Put shared durable guidance in `AGENTS.md`; use `.github/instructions/*.instructions.md` only for Copilot path-scoped rules with an `applyTo` glob.

When editing code, follow the repo's TDD expectation from `AGENTS.md`: add or update a focused Vitest test before changing behavior, mock embedding providers and other external calls, and run the narrowest relevant validation before broader checks.
