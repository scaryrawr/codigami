import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import type { CodeUnit, IndexStore } from "../../src/types.ts";
import {
  createSqliteStore,
  createSqliteStoreFromDatabase,
} from "../../src/indexing/sqlite-store.ts";

const makeUnit = (overrides: Partial<CodeUnit> = {}): CodeUnit => ({
  id: "unit-1",
  filePath: "src/foo.ts",
  startLine: 1,
  endLine: 10,
  unitType: "function",
  name: "foo",
  source: "function foo() {}",
  language: "typescript",
  ...overrides,
});

describe("createSqliteStore", () => {
  let store: IndexStore;
  let db: Database | undefined;

  afterEach(() => {
    store?.close();
    db?.close();
    db = undefined;
  });

  it("creates tables on initialization", () => {
    store = createSqliteStore(":memory:");
    // Should not throw; tables exist and accept data
    store.upsertUnits([makeUnit()]);
  });

  describe("upsertUnits", () => {
    it("inserts new code units", () => {
      store = createSqliteStore(":memory:");
      const unit = makeUnit();
      store.upsertUnits([unit]);
      store.storeEmbeddings([{ unitId: unit.id, embedding: [1, 2, 3] }]);

      const results = store.getAllWithEmbeddings();
      expect(results).toHaveLength(1);
      expect(results[0].unit).toEqual(unit);
    });

    it("updates existing units on conflict", () => {
      store = createSqliteStore(":memory:");
      const unit = makeUnit({ source: "original" });
      store.upsertUnits([unit]);

      const updated = makeUnit({ source: "updated" });
      store.upsertUnits([updated]);

      store.storeEmbeddings([{ unitId: unit.id, embedding: [1] }]);
      const results = store.getAllWithEmbeddings();
      expect(results).toHaveLength(1);
      expect(results[0].unit.source).toBe("updated");
    });

    it("handles empty array", () => {
      store = createSqliteStore(":memory:");
      expect(() => store.upsertUnits([])).not.toThrow();
    });
  });

  describe("storeEmbeddings", () => {
    it("stores embeddings as Float32Array blobs and retrieves them", () => {
      store = createSqliteStore(":memory:");
      const unit = makeUnit();
      const embedding = [0.1, 0.2, 0.3, 0.4];

      store.upsertUnits([unit]);
      store.storeEmbeddings([{ unitId: unit.id, embedding }]);

      const results = store.getAllWithEmbeddings();
      expect(results).toHaveLength(1);

      // Float32 precision: compare with tolerance
      for (let i = 0; i < embedding.length; i++) {
        expect(results[0].embedding[i]).toBeCloseTo(embedding[i], 5);
      }
    });

    it("replaces existing embeddings on conflict", () => {
      store = createSqliteStore(":memory:");
      const unit = makeUnit();
      store.upsertUnits([unit]);

      store.storeEmbeddings([{ unitId: unit.id, embedding: [1, 2] }]);
      store.storeEmbeddings([{ unitId: unit.id, embedding: [3, 4] }]);

      const results = store.getAllWithEmbeddings();
      expect(results).toHaveLength(1);
      expect(results[0].embedding[0]).toBeCloseTo(3, 5);
      expect(results[0].embedding[1]).toBeCloseTo(4, 5);
    });

    it("handles empty array", () => {
      store = createSqliteStore(":memory:");
      expect(() => store.storeEmbeddings([])).not.toThrow();
    });
  });

  describe("getAllWithEmbeddings", () => {
    it("returns only units that have embeddings", () => {
      store = createSqliteStore(":memory:");
      const unitA = makeUnit({ id: "a" });
      const unitB = makeUnit({ id: "b" });
      store.upsertUnits([unitA, unitB]);

      // Only store embedding for unitA
      store.storeEmbeddings([{ unitId: "a", embedding: [1] }]);

      const results = store.getAllWithEmbeddings();
      expect(results).toHaveLength(1);
      expect(results[0].unit.id).toBe("a");
    });

    it("returns empty array when no data exists", () => {
      store = createSqliteStore(":memory:");
      expect(store.getAllWithEmbeddings()).toEqual([]);
    });

    it("handles null name field", () => {
      store = createSqliteStore(":memory:");
      const unit = makeUnit({ name: null });
      store.upsertUnits([unit]);
      store.storeEmbeddings([{ unitId: unit.id, embedding: [1] }]);

      const results = store.getAllWithEmbeddings();
      expect(results[0].unit.name).toBeNull();
    });
  });

  describe("deleteByFilePaths", () => {
    it("removes code units and cascading embeddings for given paths", () => {
      store = createSqliteStore(":memory:");
      const unitA = makeUnit({ id: "a", filePath: "src/foo.ts" });
      const unitB = makeUnit({ id: "b", filePath: "src/bar.ts" });
      store.upsertUnits([unitA, unitB]);
      store.storeEmbeddings([
        { unitId: "a", embedding: [1] },
        { unitId: "b", embedding: [2] },
      ]);

      store.deleteByFilePaths(["src/foo.ts"]);

      const results = store.getAllWithEmbeddings();
      expect(results).toHaveLength(1);
      expect(results[0].unit.id).toBe("b");
    });

    it("handles empty array without error", () => {
      store = createSqliteStore(":memory:");
      store.upsertUnits([makeUnit()]);
      store.storeEmbeddings([{ unitId: "unit-1", embedding: [1] }]);

      expect(() => store.deleteByFilePaths([])).not.toThrow();
      expect(store.getAllWithEmbeddings()).toHaveLength(1);
    });

    it("handles non-existent paths without error", () => {
      store = createSqliteStore(":memory:");
      store.upsertUnits([makeUnit()]);
      store.storeEmbeddings([{ unitId: "unit-1", embedding: [1] }]);

      expect(() => store.deleteByFilePaths(["nonexistent.ts"])).not.toThrow();
      expect(store.getAllWithEmbeddings()).toHaveLength(1);
    });

    it("removes multiple units from the same file", () => {
      store = createSqliteStore(":memory:");
      const unitA = makeUnit({ id: "a", filePath: "src/foo.ts", startLine: 1 });
      const unitB = makeUnit({ id: "b", filePath: "src/foo.ts", startLine: 10 });
      const unitC = makeUnit({ id: "c", filePath: "src/bar.ts" });
      store.upsertUnits([unitA, unitB, unitC]);
      store.storeEmbeddings([
        { unitId: "a", embedding: [1] },
        { unitId: "b", embedding: [2] },
        { unitId: "c", embedding: [3] },
      ]);

      store.deleteByFilePaths(["src/foo.ts"]);

      const results = store.getAllWithEmbeddings();
      expect(results).toHaveLength(1);
      expect(results[0].unit.id).toBe("c");
    });
  });

  describe("replaceFileUnitsWithEmbeddings", () => {
    it("replaces all existing units for a file with embedded units", () => {
      store = createSqliteStore(":memory:");
      const oldUnitA = makeUnit({ id: "old-a", filePath: "src/foo.ts" });
      const oldUnitB = makeUnit({ id: "old-b", filePath: "src/foo.ts", startLine: 20 });
      const otherFileUnit = makeUnit({ id: "other", filePath: "src/bar.ts" });
      store.upsertUnits([oldUnitA, oldUnitB, otherFileUnit]);
      store.storeEmbeddings([
        { unitId: "old-a", embedding: [1] },
        { unitId: "old-b", embedding: [2] },
        { unitId: "other", embedding: [3] },
      ]);

      const newUnit = makeUnit({
        id: "new",
        filePath: "src/foo.ts",
        source: "function replacement() {}",
      });
      store.replaceFileUnitsWithEmbeddings!(
        ["src/foo.ts"],
        [newUnit],
        [{ unitId: "new", embedding: [4] }],
      );

      const results = store.getAllWithEmbeddings();
      const byId = new Map(results.map((result) => [result.unit.id, result]));
      expect(byId.has("old-a")).toBe(false);
      expect(byId.has("old-b")).toBe(false);
      expect(byId.get("new")?.unit.source).toBe("function replacement() {}");
      expect(byId.get("other")?.embedding[0]).toBeCloseTo(3, 5);
    });

    it("rolls back stale-unit deletion and new unit insertion when embedding persistence fails", () => {
      store = createSqliteStore(":memory:");
      const oldUnit = makeUnit({ id: "old", filePath: "src/foo.ts", source: "old source" });
      const newUnit = makeUnit({ id: "new", filePath: "src/foo.ts", source: "new source" });
      store.upsertUnits([oldUnit]);
      store.storeEmbeddings([{ unitId: "old", embedding: [1] }]);

      expect(() =>
        store.replaceFileUnitsWithEmbeddings!(
          ["src/foo.ts"],
          [newUnit],
          [{ unitId: "missing-unit", embedding: [2] }],
        ),
      ).toThrow();

      const results = store.getAllWithEmbeddings();
      expect(results).toHaveLength(1);
      expect(results[0].unit).toEqual(oldUnit);
      expect(results[0].embedding[0]).toBeCloseTo(1, 5);
    });
  });

  describe("clear", () => {
    it("removes all data", () => {
      store = createSqliteStore(":memory:");
      store.upsertUnits([makeUnit()]);
      store.storeEmbeddings([{ unitId: "unit-1", embedding: [1] }]);

      store.clear();
      expect(store.getAllWithEmbeddings()).toEqual([]);
    });
  });

  describe("close", () => {
    it("closes the database", () => {
      store = createSqliteStore(":memory:");
      store.close();

      // Subsequent operations should throw
      expect(() => store.upsertUnits([makeUnit()])).toThrow();
    });
  });

  describe("round-trip", () => {
    it("stores units and embeddings then retrieves all fields correctly", () => {
      store = createSqliteStore(":memory:");

      const units: CodeUnit[] = [
        makeUnit({ id: "u1", name: "alpha", startLine: 1, endLine: 5 }),
        makeUnit({ id: "u2", name: null, startLine: 10, endLine: 20 }),
      ];
      const embeddings = [
        { unitId: "u1", embedding: [0.5, -0.3, 0.9] },
        { unitId: "u2", embedding: [1.0, 2.0, 3.0] },
      ];

      store.upsertUnits(units);
      store.storeEmbeddings(embeddings);

      const results = store.getAllWithEmbeddings();
      expect(results).toHaveLength(2);

      const byId = new Map(results.map((r) => [r.unit.id, r]));

      const r1 = byId.get("u1")!;
      expect(r1.unit.filePath).toBe("src/foo.ts");
      expect(r1.unit.startLine).toBe(1);
      expect(r1.unit.endLine).toBe(5);
      expect(r1.unit.unitType).toBe("function");
      expect(r1.unit.name).toBe("alpha");
      expect(r1.unit.language).toBe("typescript");
      for (let i = 0; i < embeddings[0].embedding.length; i++) {
        expect(r1.embedding[i]).toBeCloseTo(embeddings[0].embedding[i], 5);
      }

      const r2 = byId.get("u2")!;
      expect(r2.unit.name).toBeNull();
      expect(r2.unit.startLine).toBe(10);
      expect(r2.unit.endLine).toBe(20);
      for (let i = 0; i < embeddings[1].embedding.length; i++) {
        expect(r2.embedding[i]).toBeCloseTo(embeddings[1].embedding[i], 5);
      }
    });
  });

  describe("createSqliteStoreFromDatabase", () => {
    it("initializes tables on a caller-owned database", () => {
      db = new Database(":memory:");
      store = createSqliteStoreFromDatabase(db);

      const unit = makeUnit();
      store.upsertUnits([unit]);
      store.storeEmbeddings([{ unitId: unit.id, embedding: [1, 2, 3] }]);

      const results = store.getAllWithEmbeddings();
      expect(results).toHaveLength(1);
      expect(results[0].unit).toEqual(unit);
    });

    it("does not close the caller-owned database", () => {
      db = new Database(":memory:", { strict: true });
      store = createSqliteStoreFromDatabase(db);

      store.close();

      expect(() => db!.prepare("SELECT 1").get()).not.toThrow();
    });
  });
});
