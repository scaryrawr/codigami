import type { TreeSitterLanguageDefinition } from "../tree-sitter-language-definition.ts";
import { nameFromField, type UnitExtractionRule } from "../tree-sitter-unit-extractor.ts";

const RUBY_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "method",
    unitType: "method",
    getName: nameFromField,
  },
  {
    nodeType: "singleton_method",
    unitType: "singleton_method",
    getName: nameFromField,
  },
  {
    nodeType: "class",
    unitType: "class",
    getName: nameFromField,
    descendIntoChildren: true,
  },
  {
    nodeType: "module",
    unitType: "module",
    getName: nameFromField,
    descendIntoChildren: true,
  },
];

export const RUBY_LANGUAGE_DEFINITION: TreeSitterLanguageDefinition = {
  language: "ruby",
  extensions: [".rb"],
  wasmModule: "tree-sitter-ruby/tree-sitter-ruby.wasm",
  rules: RUBY_RULES,
};
