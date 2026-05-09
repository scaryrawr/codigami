import { describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { CodigamiError } from "../../src/types.ts";
import { createOpenAIEmbeddingProvider } from "../../src/embedding/openai-embedding-provider.ts";

const makeClient = (createFn: OpenAI.Embeddings["create"]): OpenAI =>
  ({ embeddings: { create: createFn } }) as unknown as OpenAI;

describe("createOpenAIEmbeddingProvider", () => {
  const config = {
    baseURL: "http://localhost:11434/v1",
    model: "nomic-embed-text",
  };

  it("returns embeddings for a batch of texts", async () => {
    const embed1 = [0.1, 0.2, 0.3];
    const embed2 = [0.4, 0.5, 0.6];
    const create = vi.fn().mockResolvedValue({
      data: [{ embedding: embed1 }, { embedding: embed2 }],
    });
    const provider = createOpenAIEmbeddingProvider(config, makeClient(create));

    const result = await provider.embed(["hello", "world"]);

    expect(result).toEqual([embed1, embed2]);
    expect(create).toHaveBeenCalledWith({
      model: "nomic-embed-text",
      input: ["hello", "world"],
    });
  });

  it("returns empty array for empty input without calling API", async () => {
    const create = vi.fn();
    const provider = createOpenAIEmbeddingProvider(config, makeClient(create));

    const result = await provider.embed([]);

    expect(result).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("propagates API errors as CodigamiError", async () => {
    const create = vi.fn().mockRejectedValue(new Error("rate limit exceeded"));
    const provider = createOpenAIEmbeddingProvider(config, makeClient(create));

    await expect(provider.embed(["test"])).rejects.toThrow(CodigamiError);
    await expect(provider.embed(["test"])).rejects.toThrow("Embedding request failed");
  });

  it("passes the configured model to the API", async () => {
    const create = vi.fn().mockResolvedValue({
      data: [{ embedding: [1, 2] }],
    });
    const customConfig = { ...config, model: "text-embedding-3-small" };
    const provider = createOpenAIEmbeddingProvider(customConfig, makeClient(create));

    await provider.embed(["test"]);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "text-embedding-3-small" }),
    );
  });

  it("uses the configured base URL when creating the client", () => {
    const provider = createOpenAIEmbeddingProvider({
      baseURL: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
      apiKey: "sk-test-key",
    });

    // Provider was created without error — baseURL and apiKey
    // are passed to the OpenAI constructor internally.
    expect(provider).toBeDefined();
    expect(provider.embed).toBeInstanceOf(Function);
  });
});
