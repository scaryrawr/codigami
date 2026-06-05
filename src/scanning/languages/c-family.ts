import type { TreeSitterLanguageDefinition } from "../tree-sitter-language-definition.ts";
import {
  nameFromDeclarator,
  nameFromField,
  type UnitExtractionRule,
} from "../tree-sitter-unit-extractor.ts";

const C_FAMILY_FUNCTION_RULE: UnitExtractionRule = {
  nodeType: "function_definition",
  unitType: "function_definition",
  getName: nameFromDeclarator,
};

const CPP_RULES: readonly UnitExtractionRule[] = [
  C_FAMILY_FUNCTION_RULE,
  {
    nodeType: "class_specifier",
    unitType: "class_specifier",
    getName: nameFromField,
    descendIntoChildren: true,
  },
  {
    nodeType: "struct_specifier",
    unitType: "struct_specifier",
    getName: nameFromField,
    descendIntoChildren: true,
  },
];

const C_RULES: readonly UnitExtractionRule[] = [C_FAMILY_FUNCTION_RULE];

export const CPP_LANGUAGE_DEFINITION: TreeSitterLanguageDefinition = {
  language: "cpp",
  extensions: [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hh", ".hxx", ".h++", ".h"],
  wasmModule: "tree-sitter-cpp/tree-sitter-cpp.wasm",
  rules: CPP_RULES,
};

export const C_LANGUAGE_DEFINITION: TreeSitterLanguageDefinition = {
  language: "c",
  extensions: [".c"],
  wasmModule: "tree-sitter-c/tree-sitter-c.wasm",
  rules: C_RULES,
};
