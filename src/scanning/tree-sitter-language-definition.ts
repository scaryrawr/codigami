import type { Node } from "web-tree-sitter";
import type { CodeUnit } from "../types.ts";
import type { UnitExtractionRule } from "./tree-sitter-unit-extractor.ts";

export interface TreeSitterLanguageDefinition {
  readonly language: string;
  readonly extensions: readonly string[];
  readonly wasmModule: string;
  readonly cacheKey?: string;
  readonly rules?: readonly UnitExtractionRule[];
  readonly extract?: (rootNode: Node, filePath: string, language: string) => CodeUnit[];
}
