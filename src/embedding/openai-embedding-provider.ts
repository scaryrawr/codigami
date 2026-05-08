import OpenAI from "openai";
import { CodigamiError, type EmbeddingProvider } from "../types.ts";

export interface OpenAIEmbeddingConfig {
  baseURL: string;
  model: string;
  apiKey?: string;
}

export const createOpenAIEmbeddingProvider = (
  config: OpenAIEmbeddingConfig,
  client?: OpenAI,
): EmbeddingProvider => {
  const openai =
    client ??
    new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey ?? "no-key",
    });

  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) {
        return [];
      }

      try {
        const response = await openai.embeddings.create({
          model: config.model,
          input: texts,
        });

        return response.data.map((item) => item.embedding);
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        throw new CodigamiError(`Embedding request failed: ${cause}`, {
          model: config.model,
          endpoint: config.baseURL,
          inputCount: texts.length,
        });
      }
    },
  };
};
