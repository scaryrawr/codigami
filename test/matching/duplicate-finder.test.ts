import { describe, expect, it } from "vitest";
import {
  clusterDuplicates,
  findDuplicatePairs,
} from "../../src/matching/duplicate-finder.ts";
import type { CodeUnit, DuplicatePair } from "../../src/types.ts";

const makeUnit = (id: string): CodeUnit => ({
  id,
  filePath: `src/${id}.ts`,
  startLine: 1,
  endLine: 10,
  unitType: "function",
  name: id,
  source: `function ${id}() {}`,
  language: "typescript",
});

describe("findDuplicatePairs", () => {
  it("finds pairs above threshold", () => {
    const a = makeUnit("a");
    const b = makeUnit("b");
    const entries = [
      { unit: a, embedding: [1, 0] },
      { unit: b, embedding: [1, 0] },
    ];

    const pairs = findDuplicatePairs(entries, 0.9);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].unitA.id).toBe("a");
    expect(pairs[0].unitB.id).toBe("b");
    expect(pairs[0].similarity).toBeCloseTo(1.0);
  });

  it("does not return pairs below threshold", () => {
    const entries = [
      { unit: makeUnit("a"), embedding: [1, 0] },
      { unit: makeUnit("b"), embedding: [0, 1] },
    ];

    const pairs = findDuplicatePairs(entries, 0.5);
    expect(pairs).toHaveLength(0);
  });

  it("returns empty array when no duplicates", () => {
    const entries = [
      { unit: makeUnit("a"), embedding: [1, 0, 0] },
      { unit: makeUnit("b"), embedding: [0, 1, 0] },
      { unit: makeUnit("c"), embedding: [0, 0, 1] },
    ];

    expect(findDuplicatePairs(entries, 0.5)).toEqual([]);
  });

  it("handles single unit (no pairs possible)", () => {
    const entries = [{ unit: makeUnit("a"), embedding: [1, 2, 3] }];
    expect(findDuplicatePairs(entries, 0.0)).toEqual([]);
  });

  it("handles empty entries", () => {
    expect(findDuplicatePairs([], 0.5)).toEqual([]);
  });

  it("does not produce duplicate pairs (A,B and B,A)", () => {
    const entries = [
      { unit: makeUnit("a"), embedding: [1, 1] },
      { unit: makeUnit("b"), embedding: [1, 1] },
    ];

    const pairs = findDuplicatePairs(entries, 0.5);
    expect(pairs).toHaveLength(1);
  });
});

describe("clusterDuplicates", () => {
  it("clusters connected duplicates (A≈B, B≈C → {A,B,C})", () => {
    const a = makeUnit("a");
    const b = makeUnit("b");
    const c = makeUnit("c");

    const pairs: DuplicatePair[] = [
      { unitA: a, unitB: b, similarity: 0.95 },
      { unitA: b, unitB: c, similarity: 0.92 },
    ];

    const clusters = clusterDuplicates(pairs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].units).toHaveLength(3);

    const unitIds = clusters[0].units.map((u) => u.id).sort();
    expect(unitIds).toEqual(["a", "b", "c"]);

    expect(clusters[0].pairs).toHaveLength(2);
  });

  it("does not merge unrelated pairs into same cluster", () => {
    const a = makeUnit("a");
    const b = makeUnit("b");
    const c = makeUnit("c");
    const d = makeUnit("d");

    const pairs: DuplicatePair[] = [
      { unitA: a, unitB: b, similarity: 0.95 },
      { unitA: c, unitB: d, similarity: 0.90 },
    ];

    const clusters = clusterDuplicates(pairs);
    expect(clusters).toHaveLength(2);

    const clusterIds = clusters
      .map((cl) => cl.units.map((u) => u.id).sort())
      .sort((x, y) => x[0].localeCompare(y[0]));

    expect(clusterIds).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("each cluster's pairs array contains the relevant pairs", () => {
    const a = makeUnit("a");
    const b = makeUnit("b");
    const c = makeUnit("c");
    const d = makeUnit("d");

    const pairs: DuplicatePair[] = [
      { unitA: a, unitB: b, similarity: 0.95 },
      { unitA: c, unitB: d, similarity: 0.90 },
    ];

    const clusters = clusterDuplicates(pairs);

    for (const cluster of clusters) {
      const unitIds = new Set(cluster.units.map((u) => u.id));
      for (const pair of cluster.pairs) {
        expect(unitIds.has(pair.unitIdA)).toBe(true);
        expect(unitIds.has(pair.unitIdB)).toBe(true);
      }
    }
  });

  it("each cluster's units array contains all units in the cluster", () => {
    const a = makeUnit("a");
    const b = makeUnit("b");
    const c = makeUnit("c");

    const pairs: DuplicatePair[] = [
      { unitA: a, unitB: b, similarity: 0.95 },
      { unitA: a, unitB: c, similarity: 0.88 },
    ];

    const clusters = clusterDuplicates(pairs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].units).toHaveLength(3);
  });

  it("returns empty array when no pairs", () => {
    expect(clusterDuplicates([])).toEqual([]);
  });
});
