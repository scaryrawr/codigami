import type { TreeSitterLanguageDefinition } from "../tree-sitter-language-definition.ts";
import { BASH_LANGUAGE_DEFINITION } from "./bash.ts";
import { C_LANGUAGE_DEFINITION, CPP_LANGUAGE_DEFINITION } from "./c-family.ts";
import { CSHARP_LANGUAGE_DEFINITION } from "./csharp.ts";
import { CSS_LANGUAGE_DEFINITION } from "./css.ts";
import { GO_LANGUAGE_DEFINITION } from "./go.ts";
import { JAVA_LANGUAGE_DEFINITION } from "./java.ts";
import { PYTHON_LANGUAGE_DEFINITION } from "./python.ts";
import { RUBY_LANGUAGE_DEFINITION } from "./ruby.ts";
import { RUST_LANGUAGE_DEFINITION } from "./rust.ts";
import { TYPESCRIPT_LANGUAGE_DEFINITIONS } from "./typescript.ts";

export const DEFAULT_LANGUAGE_DEFINITIONS: readonly TreeSitterLanguageDefinition[] = [
  ...TYPESCRIPT_LANGUAGE_DEFINITIONS,
  RUST_LANGUAGE_DEFINITION,
  CSHARP_LANGUAGE_DEFINITION,
  CPP_LANGUAGE_DEFINITION,
  C_LANGUAGE_DEFINITION,
  GO_LANGUAGE_DEFINITION,
  PYTHON_LANGUAGE_DEFINITION,
  BASH_LANGUAGE_DEFINITION,
  CSS_LANGUAGE_DEFINITION,
  JAVA_LANGUAGE_DEFINITION,
  RUBY_LANGUAGE_DEFINITION,
];

export const DEFAULT_LANGUAGE_EXTENSIONS: readonly string[] = Array.from(
  new Set(DEFAULT_LANGUAGE_DEFINITIONS.flatMap((definition) => definition.extensions)),
);
