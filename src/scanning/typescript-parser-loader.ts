import { createRequire } from "node:module";
import { extname } from "node:path";
import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);

type TypescriptParserVariant = "typescript" | "tsx";

const WASM_MODULE_BY_VARIANT: Record<TypescriptParserVariant, string> = {
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
};

const parserVariantForFilePath = (filePath: string): TypescriptParserVariant => {
  const extension = extname(filePath);
  return extension === ".tsx" || extension === ".jsx" ? "tsx" : "typescript";
};

export interface LazyTypescriptParserLoader {
  getParserForFilePath(filePath: string): Promise<Parser>;
}

export interface LazyTypescriptParserLoaderDependencies {
  loadLanguage(wasmPath: string): Promise<Language>;
  createParser(): Parser;
  resolveWasmModule(wasmModule: string): string;
}

const defaultDependencies: LazyTypescriptParserLoaderDependencies = {
  loadLanguage: (wasmPath: string) => Language.load(wasmPath),
  createParser: () => new Parser(),
  resolveWasmModule: (wasmModule: string) => require.resolve(wasmModule),
};

export const createLazyTypescriptParserLoader = (
  dependencies: LazyTypescriptParserLoaderDependencies = defaultDependencies,
): LazyTypescriptParserLoader => {
  const parserByVariant = new Map<TypescriptParserVariant, Promise<Parser>>();

  const loadParser = async (variant: TypescriptParserVariant): Promise<Parser> => {
    const language = await dependencies.loadLanguage(
      dependencies.resolveWasmModule(WASM_MODULE_BY_VARIANT[variant]),
    );
    const parser = dependencies.createParser();
    parser.setLanguage(language);
    return parser;
  };

  const getParserForVariant = (variant: TypescriptParserVariant): Promise<Parser> => {
    const existing = parserByVariant.get(variant);
    if (existing) return existing;

    const loading = loadParser(variant);
    parserByVariant.set(variant, loading);
    return loading;
  };

  return {
    getParserForFilePath(filePath: string): Promise<Parser> {
      return getParserForVariant(parserVariantForFilePath(filePath));
    },
  };
};
