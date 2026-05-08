import { afterEach, describe, expect, it } from "vitest";
import type { FileHashStore } from "../../src/types.ts";
import { createSqliteHashStore } from "../../src/indexing/sqlite-hash-store.ts";
import Database from "better-sqlite3";

describe("createSqliteHashStore", () => {
	let db: InstanceType<typeof Database>;
	let store: FileHashStore;

	afterEach(() => {
		store?.close();
		if (db?.open) db.close();
	});

	it("creates table on initialization", () => {
		db = new Database(":memory:");
		store = createSqliteHashStore(db);
		// Should not throw
		store.setHash("foo.ts", "abc123");
	});

	describe("getHashes", () => {
		it("returns empty map when no hashes stored", () => {
			db = new Database(":memory:");
			store = createSqliteHashStore(db);
			expect(store.getHashes()).toEqual(new Map());
		});

		it("returns all stored hashes", () => {
			db = new Database(":memory:");
			store = createSqliteHashStore(db);
			store.setHash("a.ts", "hash-a");
			store.setHash("b.ts", "hash-b");

			const hashes = store.getHashes();
			expect(hashes.size).toBe(2);
			expect(hashes.get("a.ts")).toBe("hash-a");
			expect(hashes.get("b.ts")).toBe("hash-b");
		});
	});

	describe("setHash", () => {
		it("inserts a new hash", () => {
			db = new Database(":memory:");
			store = createSqliteHashStore(db);
			store.setHash("src/foo.ts", "deadbeef");

			const hashes = store.getHashes();
			expect(hashes.get("src/foo.ts")).toBe("deadbeef");
		});

		it("updates existing hash on conflict", () => {
			db = new Database(":memory:");
			store = createSqliteHashStore(db);
			store.setHash("src/foo.ts", "old-hash");
			store.setHash("src/foo.ts", "new-hash");

			const hashes = store.getHashes();
			expect(hashes.size).toBe(1);
			expect(hashes.get("src/foo.ts")).toBe("new-hash");
		});
	});

	describe("removeFiles", () => {
		it("removes specified file hashes", () => {
			db = new Database(":memory:");
			store = createSqliteHashStore(db);
			store.setHash("a.ts", "h1");
			store.setHash("b.ts", "h2");
			store.setHash("c.ts", "h3");

			store.removeFiles(["a.ts", "c.ts"]);

			const hashes = store.getHashes();
			expect(hashes.size).toBe(1);
			expect(hashes.get("b.ts")).toBe("h2");
		});

		it("handles empty array without error", () => {
			db = new Database(":memory:");
			store = createSqliteHashStore(db);
			store.setHash("a.ts", "h1");

			expect(() => store.removeFiles([])).not.toThrow();
			expect(store.getHashes().size).toBe(1);
		});

		it("handles non-existent paths without error", () => {
			db = new Database(":memory:");
			store = createSqliteHashStore(db);
			store.setHash("a.ts", "h1");

			expect(() => store.removeFiles(["nonexistent.ts"])).not.toThrow();
			expect(store.getHashes().size).toBe(1);
		});
	});

	describe("close", () => {
		it("does not close the shared database instance", () => {
			db = new Database(":memory:");
			store = createSqliteHashStore(db);
			store.close();

			// The shared db should still be usable
			expect(db.open).toBe(true);
		});
	});
});
