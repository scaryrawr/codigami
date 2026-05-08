import { type DuplicateCluster, type DuplicateReport } from "../types.ts";

export interface FormatInput {
  scannedFiles: number;
  totalUnits: number;
  clusters: DuplicateCluster[];
  threshold: number;
}

export const formatReport = (input: FormatInput): DuplicateReport => {
  return {
    scannedFiles: input.scannedFiles,
    totalUnits: input.totalUnits,
    duplicateClusters: input.clusters,
    threshold: input.threshold,
    timestamp: new Date().toISOString(),
  };
};
