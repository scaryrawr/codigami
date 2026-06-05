import type { TreeSitterLanguageDefinition } from "../tree-sitter-language-definition.ts";
import { nameFromField, type UnitExtractionRule } from "../tree-sitter-unit-extractor.ts";

const JAVA_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "class_declaration",
    unitType: "class_declaration",
    getName: nameFromField,
    descendIntoChildren: true,
  },
  {
    nodeType: "interface_declaration",
    unitType: "interface_declaration",
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
    nodeType: "enum_declaration",
    unitType: "enum_declaration",
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
  {
    nodeType: "compact_constructor_declaration",
    unitType: "compact_constructor_declaration",
    getName: nameFromField,
  },
];

export const JAVA_LANGUAGE_DEFINITION: TreeSitterLanguageDefinition = {
  language: "java",
  extensions: [".java"],
  wasmModule: "tree-sitter-java/tree-sitter-java.wasm",
  rules: JAVA_RULES,
};
