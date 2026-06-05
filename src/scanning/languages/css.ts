import type { TreeSitterLanguageDefinition } from "../tree-sitter-language-definition.ts";
import { nameFromFirstChild, type UnitExtractionRule } from "../tree-sitter-unit-extractor.ts";

const CSS_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "rule_set",
    unitType: "rule_set",
    getName: nameFromFirstChild("selectors"),
  },
];

export const CSS_LANGUAGE_DEFINITION: TreeSitterLanguageDefinition = {
  language: "css",
  extensions: [".css"],
  wasmModule: "tree-sitter-css/tree-sitter-css.wasm",
  rules: CSS_RULES,
};
