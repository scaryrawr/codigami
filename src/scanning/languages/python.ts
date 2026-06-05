import type { TreeSitterLanguageDefinition } from "../tree-sitter-language-definition.ts";
import { nameFromField, type UnitExtractionRule } from "../tree-sitter-unit-extractor.ts";

const PYTHON_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "function_definition",
    unitType: "function_definition",
    getName: nameFromField,
  },
  {
    nodeType: "class_definition",
    unitType: "class_definition",
    getName: nameFromField,
    descendIntoChildren: true,
  },
];

export const PYTHON_LANGUAGE_DEFINITION: TreeSitterLanguageDefinition = {
  language: "python",
  extensions: [".py"],
  wasmModule: "tree-sitter-python/tree-sitter-python.wasm",
  rules: PYTHON_RULES,
};
