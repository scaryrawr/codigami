import { parentPort } from "node:worker_threads";
import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";
import { type CodeUnit } from "../types.ts";
import { extractCodeUnitsFromRootNode } from "./typescript-unit-extractor.ts";

const require = createRequire(import.meta.url);

export interface ParseRequest {
  id: number;
  filePath: string;
  source: string;
}

export interface ParseResponse {
  id: number;
  units?: CodeUnit[];
  error?: string;
}

const init = async (): Promise<void> => {
  await Parser.init();
  const tsWasmPath = require.resolve("tree-sitter-typescript/tree-sitter-typescript.wasm");
  const tsLanguage = await Language.load(tsWasmPath);

  const tsParser = new Parser();
  tsParser.setLanguage(tsLanguage);

  const lang = "typescript";

  parentPort!.on("message", (request: ParseRequest) => {
    try {
      const tree = tsParser.parse(request.source);
      if (!tree) {
        const response: ParseResponse = { id: request.id, units: [] };
        parentPort!.postMessage(response);
        return;
      }

      const units = extractCodeUnitsFromRootNode(tree.rootNode, request.filePath, lang);
      const response: ParseResponse = { id: request.id, units };
      parentPort!.postMessage(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const response: ParseResponse = { id: request.id, error: message };
      parentPort!.postMessage(response);
    }
  });

  // Signal that the worker is ready
  parentPort!.postMessage({ ready: true });
};

init().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  parentPort!.postMessage({ initError: message });
  process.exit(1);
});
