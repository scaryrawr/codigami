import type { TreeSitterLanguageDefinition } from "../tree-sitter-language-definition.ts";
import { extractCodeUnitsFromRootNode as extractTypescriptCodeUnits } from "../typescript-unit-extractor.ts";

export const TYPESCRIPT_LANGUAGE_DEFINITIONS: readonly TreeSitterLanguageDefinition[] = [
  {
    language: "typescript",
    extensions: [".ts", ".js"],
    wasmModule: "tree-sitter-typescript/tree-sitter-typescript.wasm",
    extract: extractTypescriptCodeUnits,
  },
  {
    language: "typescript",
    extensions: [".tsx", ".jsx"],
    wasmModule: "tree-sitter-typescript/tree-sitter-tsx.wasm",
    extract: extractTypescriptCodeUnits,
  },
];
