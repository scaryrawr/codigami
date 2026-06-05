import type { TreeSitterLanguageDefinition } from "../tree-sitter-language-definition.ts";
import { nameFromField, type UnitExtractionRule } from "../tree-sitter-unit-extractor.ts";

const CSHARP_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "class_declaration",
    unitType: "class_declaration",
    getName: nameFromField,
    descendIntoChildren: true,
  },
  {
    nodeType: "struct_declaration",
    unitType: "struct_declaration",
    getName: nameFromField,
    descendIntoChildren: true,
  },
  {
    nodeType: "record_declaration",
    unitType: "record_declaration",
    getName: nameFromField,
    descendIntoChildren: true,
  },
  {
    nodeType: "method_declaration",
    unitType: "method_declaration",
    getName: nameFromField,
  },
  {
    nodeType: "constructor_declaration",
    unitType: "constructor_declaration",
    getName: nameFromField,
  },
];

export const CSHARP_LANGUAGE_DEFINITION: TreeSitterLanguageDefinition = {
  language: "csharp",
  extensions: [".cs"],
  wasmModule: "tree-sitter-c-sharp/tree-sitter-c_sharp.wasm",
  rules: CSHARP_RULES,
};
