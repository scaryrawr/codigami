import { parentPort } from "node:worker_threads";
import { Parser } from "web-tree-sitter";
import { type CodeUnit } from "../types.ts";
import { createLazyTypescriptParserLoader } from "./typescript-parser-loader.ts";
import { extractCodeUnitsFromRootNode } from "./typescript-unit-extractor.ts";

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
  const parserLoader = createLazyTypescriptParserLoader();
  const lang = "typescript";

  parentPort!.on("message", async (request: ParseRequest) => {
    try {
      const parser = await parserLoader.getParserForFilePath(request.filePath);
      const tree = parser.parse(request.source);
      if (!tree) {
        const response: ParseResponse = { id: request.id, units: [] };
        parentPort!.postMessage(response);
        return;
      }

      try {
        const units = extractCodeUnitsFromRootNode(tree.rootNode, request.filePath, lang);
        const response: ParseResponse = { id: request.id, units };
        parentPort!.postMessage(response);
      } finally {
        tree.delete();
      }
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
