import { describe, expect, it } from "bun:test";

import type { DuplicateCluster, DuplicateReport } from "../../src/types";
import { formatReport, type FormatInput } from "../../src/output/json-formatter";

const makeCluster = (): DuplicateCluster => ({
  units: [
    {
      id: "aaa",
      filePath: "src/a.ts",
      startLine: 1,
      endLine: 10,
      unitType: "function",
      name: "foo",
      source: "function foo() {}",
      language: "typescript",
    },
    {
      id: "bbb",
      filePath: "src/b.ts",
      startLine: 5,
      endLine: 15,
      unitType: "function",
      name: "bar",
      source: "function bar() {}",
      language: "typescript",
    },
  ],
  pairs: [{ unitIdA: "aaa", unitIdB: "bbb", similarity: 0.95 }],
});

describe("formatReport", () => {
  it("produces a valid DuplicateReport with all required fields", () => {
    const input: FormatInput = {
      scannedFiles: 10,
      totalUnits: 42,
      clusters: [makeCluster()],
      threshold: 0.8,
    };

    const report: DuplicateReport = formatReport(input);

    expect(report).toHaveProperty("scannedFiles");
    expect(report).toHaveProperty("totalUnits");
    expect(report).toHaveProperty("duplicateClusters");
    expect(report).toHaveProperty("threshold");
    expect(report).toHaveProperty("timestamp");
  });

  it("sets correct scannedFiles and totalUnits counts", () => {
    const report = formatReport({
      scannedFiles: 7,
      totalUnits: 25,
      clusters: [],
      threshold: 0.9,
    });

    expect(report.scannedFiles).toBe(7);
    expect(report.totalUnits).toBe(25);
  });

  it("includes clusters from input", () => {
    const cluster = makeCluster();
    const report = formatReport({
      scannedFiles: 2,
      totalUnits: 2,
      clusters: [cluster],
      threshold: 0.8,
    });

    expect(report.duplicateClusters).toHaveLength(1);
    expect(report.duplicateClusters[0]).toBe(cluster);
  });

  it("sets threshold from input", () => {
    const report = formatReport({
      scannedFiles: 1,
      totalUnits: 1,
      clusters: [],
      threshold: 0.75,
    });

    expect(report.threshold).toBe(0.75);
  });

  it("sets a valid ISO timestamp", () => {
    const before = new Date().toISOString();
    const report = formatReport({
      scannedFiles: 0,
      totalUnits: 0,
      clusters: [],
      threshold: 0.8,
    });
    const after = new Date().toISOString();

    expect(report.timestamp).toBeTruthy();
    expect(report.timestamp >= before).toBe(true);
    expect(report.timestamp <= after).toBe(true);
    // Must parse as a valid Date
    expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
  });

  it("handles zero clusters (no duplicates found)", () => {
    const report = formatReport({
      scannedFiles: 5,
      totalUnits: 20,
      clusters: [],
      threshold: 0.8,
    });

    expect(report.duplicateClusters).toEqual([]);
    expect(report.scannedFiles).toBe(5);
    expect(report.totalUnits).toBe(20);
  });

  it("handles zero scanned files", () => {
    const report = formatReport({
      scannedFiles: 0,
      totalUnits: 0,
      clusters: [],
      threshold: 0.8,
    });

    expect(report.scannedFiles).toBe(0);
    expect(report.totalUnits).toBe(0);
    expect(report.duplicateClusters).toEqual([]);
  });
});
