import type { Node } from "web-tree-sitter";
import type { TreeSitterLanguageDefinition } from "../tree-sitter-language-definition.ts";
import {
  nameFromField,
  nameFromFirstChild,
  type UnitExtractionRule,
} from "../tree-sitter-unit-extractor.ts";

const nameFromRustImpl = (node: Node): string | null => {
  return (
    node.childForFieldName("type")?.text ??
    node.childForFieldName("trait")?.text ??
    nameFromFirstChild("type_identifier", "scoped_type_identifier", "generic_type")(node)
  );
};

const RUST_RULES: readonly UnitExtractionRule[] = [
  {
    nodeType: "function_item",
    unitType: "function_item",
    getName: nameFromField,
  },
  {
    nodeType: "impl_item",
    unitType: "impl_item",
    getName: nameFromRustImpl,
    descendIntoChildren: true,
  },
];

export const RUST_LANGUAGE_DEFINITION: TreeSitterLanguageDefinition = {
  language: "rust",
  extensions: [".rs"],
  wasmModule: "tree-sitter-rust/tree-sitter-rust.wasm",
  rules: RUST_RULES,
};
