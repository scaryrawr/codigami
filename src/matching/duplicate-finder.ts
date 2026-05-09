import { type CodeUnit, type DuplicateCluster, type DuplicatePair } from "../types.ts";
import { cosineSimilarity } from "./similarity.ts";

type DuplicateEntry = { unit: CodeUnit; embedding: number[] };

export interface DuplicatePairSearchOptions {
  /**
   * Inputs at or below this size keep exact all-pairs behavior.
   */
  exhaustiveSearchLimit?: number;
  /**
   * Inputs above exhaustiveSearchLimit compare each unit to at most this many
   * previously indexed candidates.
   */
  maxCandidatesPerUnit?: number;
  /**
   * Number of signed high-magnitude dimensions used for deterministic buckets.
   */
  signatureDimensions?: number;
  /**
   * Number of signed dimensions per band bucket.
   */
  signatureBandSize?: number;
}

const DEFAULT_EXHAUSTIVE_SEARCH_LIMIT = 1024;
const DEFAULT_MAX_CANDIDATES_PER_UNIT = 64;
const DEFAULT_SIGNATURE_DIMENSIONS = 12;
const DEFAULT_SIGNATURE_BAND_SIZE = 2;
const VECTOR_FINGERPRINT_PRECISION = 1000;

export const findDuplicatePairs = (
  entries: DuplicateEntry[],
  threshold: number,
  options: DuplicatePairSearchOptions = {},
): DuplicatePair[] => {
  if (entries.length <= 1) return [];

  const normalizedOptions = normalizeSearchOptions(options);
  if (entries.length <= normalizedOptions.exhaustiveSearchLimit) {
    return findDuplicatePairsExhaustive(entries, threshold);
  }

  return findDuplicatePairsBounded(entries, threshold, normalizedOptions);
};

interface NormalizedSearchOptions {
  exhaustiveSearchLimit: number;
  maxCandidatesPerUnit: number;
  signatureDimensions: number;
  signatureBandSize: number;
}

const normalizeSearchOptions = (options: DuplicatePairSearchOptions): NormalizedSearchOptions => ({
  exhaustiveSearchLimit: normalizeIntegerAtLeast(
    options.exhaustiveSearchLimit,
    DEFAULT_EXHAUSTIVE_SEARCH_LIMIT,
    0,
  ),
  maxCandidatesPerUnit: normalizeIntegerAtLeast(
    options.maxCandidatesPerUnit,
    DEFAULT_MAX_CANDIDATES_PER_UNIT,
    1,
  ),
  signatureDimensions: normalizeIntegerAtLeast(
    options.signatureDimensions,
    DEFAULT_SIGNATURE_DIMENSIONS,
    1,
  ),
  signatureBandSize: normalizeIntegerAtLeast(
    options.signatureBandSize,
    DEFAULT_SIGNATURE_BAND_SIZE,
    1,
  ),
});

const normalizeIntegerAtLeast = (
  value: number | undefined,
  fallback: number,
  minimum: number,
): number => {
  if (value === undefined) return fallback;
  return Number.isInteger(value) && value >= minimum ? value : fallback;
};

const findDuplicatePairsExhaustive = (
  entries: DuplicateEntry[],
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

const findDuplicatePairsBounded = (
  entries: DuplicateEntry[],
  threshold: number,
  options: NormalizedSearchOptions,
): DuplicatePair[] => {
  const pairs: DuplicatePair[] = [];
  const buckets = new Map<string, number[]>();

  for (let i = 0; i < entries.length; i++) {
    const signatures = createSignatureKeys(entries[i].embedding, options);
    const candidates = selectCandidates(signatures, buckets, options.maxCandidatesPerUnit);

    for (const candidateIndex of candidates) {
      const sim = cosineSimilarity(entries[candidateIndex].embedding, entries[i].embedding);
      if (sim >= threshold) {
        pairs.push({
          unitA: entries[candidateIndex].unit,
          unitB: entries[i].unit,
          similarity: sim,
        });
      }
    }

    for (const signature of signatures) {
      const bucket = buckets.get(signature);
      if (bucket) {
        bucket.push(i);
      } else {
        buckets.set(signature, [i]);
      }
    }
  }

  return pairs;
};

interface SignedDimension {
  index: number;
  sign: "+" | "-";
  magnitude: number;
}

const createSignatureKeys = (
  embedding: number[],
  options: Pick<NormalizedSearchOptions, "signatureBandSize" | "signatureDimensions">,
): string[] => {
  const topDimensions = embedding
    .map(
      (value, index): SignedDimension => ({
        index,
        sign: value < 0 ? "-" : "+",
        magnitude: Math.abs(value),
      }),
    )
    .filter((dimension) => dimension.magnitude > 0)
    .sort((a, b) => b.magnitude - a.magnitude || a.index - b.index || a.sign.localeCompare(b.sign))
    .slice(0, options.signatureDimensions);

  if (topDimensions.length === 0) return ["zero-vector"];

  const keys = new Set<string>();
  const signedDimensions = topDimensions.map((dimension) => `${dimension.sign}${dimension.index}`);
  const magnitude = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));
  const fingerprint = topDimensions
    .map((dimension) => {
      const normalizedValue = embedding[dimension.index] / magnitude;
      return `${dimension.index}:${Math.round(normalizedValue * VECTOR_FINGERPRINT_PRECISION)}`;
    })
    .join("|");

  keys.add(`fingerprint:${fingerprint}`);
  keys.add(`top:${signedDimensions.join("|")}`);

  for (let i = 0; i < signedDimensions.length; i += options.signatureBandSize) {
    keys.add(`band:${signedDimensions.slice(i, i + options.signatureBandSize).join("|")}`);
  }

  for (const signedDimension of signedDimensions) {
    keys.add(`dim:${signedDimension}`);
  }

  return [...keys];
};

const selectCandidates = (
  signatures: string[],
  buckets: Map<string, number[]>,
  maxCandidates: number,
): number[] => {
  const candidates: number[] = [];
  const seen = new Set<number>();
  const bucketScanLimit = Math.max(
    1,
    Math.ceil(maxCandidates / Math.max(1, signatures.length * 2)),
  );

  const addCandidate = (candidate: number): void => {
    if (!seen.has(candidate) && candidates.length < maxCandidates) {
      seen.add(candidate);
      candidates.push(candidate);
    }
  };

  for (const signature of signatures) {
    const bucket = buckets.get(signature);
    if (!bucket) continue;
    for (
      let i = bucket.length - 1, scanned = 0;
      i >= 0 && scanned < bucketScanLimit && candidates.length < maxCandidates;
      i--, scanned++
    ) {
      addCandidate(bucket[i]);
    }
  }

  for (const signature of signatures) {
    const bucket = buckets.get(signature);
    if (!bucket) continue;
    for (
      let i = 0, scanned = 0;
      i < bucket.length && scanned < bucketScanLimit && candidates.length < maxCandidates;
      i++, scanned++
    ) {
      addCandidate(bucket[i]);
    }
  }

  return candidates;
};

export const clusterDuplicates = (pairs: DuplicatePair[]): DuplicateCluster[] => {
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
