import type { TreeSitterLanguageDefinition } from "../tree-sitter-language-definition.ts";
import { nameFromFirstChild, type UnitExtractionRule } from "../tree-sitter-unit-extractor.ts";

const BASH_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "function_definition",
    unitType: "function_definition",
    getName: nameFromFirstChild("word"),
    descendIntoChildren: true,
  },
];

export const BASH_LANGUAGE_DEFINITION: TreeSitterLanguageDefinition = {
  language: "bash",
  extensions: [".sh", ".bash"],
  wasmModule: "tree-sitter-bash/tree-sitter-bash.wasm",
  rules: BASH_RULES,
};
