import type { TreeSitterLanguageDefinition } from "../tree-sitter-language-definition.ts";
import { nameFromField, type UnitExtractionRule } from "../tree-sitter-unit-extractor.ts";

const GO_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "function_declaration",
    unitType: "function_declaration",
    getName: nameFromField,
  },
  {
    nodeType: "method_declaration",
    unitType: "method_declaration",
    getName: nameFromField,
  },
];

export const GO_LANGUAGE_DEFINITION: TreeSitterLanguageDefinition = {
  language: "go",
  extensions: [".go"],
  wasmModule: "tree-sitter-go/tree-sitter-go.wasm",
  rules: GO_RULES,
};
