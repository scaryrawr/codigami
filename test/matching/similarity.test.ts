import { describe, expect, it } from "bun:test";
import { cosineSimilarity } from "../../src/matching/similarity.ts";

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it("computes known similarity correctly", () => {
    // cos([1,0,1], [0,1,1]) = 1 / (sqrt(2) * sqrt(2)) = 0.5
    expect(cosineSimilarity([1, 0, 1], [0, 1, 1])).toBeCloseTo(0.5);
  });

  it("returns 0.0 for a zero vector", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("handles single-dimension vectors", () => {
    expect(cosineSimilarity([5], [3])).toBeCloseTo(1.0);
  });

  it("handles negative components", () => {
    // cos([1], [-1]) = -1 / (1 * 1) = -1
    expect(cosineSimilarity([1], [-1])).toBeCloseTo(-1.0);
    // cos([1,-1], [-1,1]) = (-1 + -1) / (sqrt(2)*sqrt(2)) = -1
    expect(cosineSimilarity([1, -1], [-1, 1])).toBeCloseTo(-1.0);
  });

  it("returns 0.0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0.0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});
