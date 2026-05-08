import {
  type CodeUnit,
  type DuplicateCluster,
  type DuplicatePair,
} from "../types.ts";
import { cosineSimilarity } from "./similarity.ts";

export const findDuplicatePairs = (
  entries: { unit: CodeUnit; embedding: number[] }[],
  threshold: number,
): DuplicatePair[] => {
  const pairs: DuplicatePair[] = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const sim = cosineSimilarity(entries[i].embedding, entries[j].embedding);
      if (sim >= threshold) {
        pairs.push({
          unitA: entries[i].unit,
          unitB: entries[j].unit,
          similarity: sim,
        });
      }
    }
  }

  return pairs;
};

export const clusterDuplicates = (
  pairs: DuplicatePair[],
): DuplicateCluster[] => {
  if (pairs.length === 0) return [];

  const parent = new Map<string, string>();
  const unitMap = new Map<string, CodeUnit>();

  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Path compression
    let current = id;
    while (current !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };

  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  };

  for (const pair of pairs) {
    const idA = pair.unitA.id;
    const idB = pair.unitB.id;
    if (!parent.has(idA)) parent.set(idA, idA);
    if (!parent.has(idB)) parent.set(idB, idB);
    unitMap.set(idA, pair.unitA);
    unitMap.set(idB, pair.unitB);
    union(idA, idB);
  }

  const clusterMap = new Map<
    string,
    { units: Map<string, CodeUnit>; pairs: DuplicateCluster["pairs"] }
  >();

  for (const pair of pairs) {
    const root = find(pair.unitA.id);
    let cluster = clusterMap.get(root);
    if (!cluster) {
      cluster = { units: new Map(), pairs: [] };
      clusterMap.set(root, cluster);
    }
    cluster.units.set(pair.unitA.id, pair.unitA);
    cluster.units.set(pair.unitB.id, pair.unitB);
    cluster.pairs.push({
      unitIdA: pair.unitA.id,
      unitIdB: pair.unitB.id,
      similarity: pair.similarity,
    });
  }

  return [...clusterMap.values()].map((c) => ({
    units: [...c.units.values()],
    pairs: c.pairs,
  }));
};
