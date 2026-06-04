import { describe, expect, it } from "bun:test";
import { openSqliteDatabase } from "../../src/indexing/sqlite-database.ts";

describe("openSqliteDatabase", () => {
  it("opens Bun sqlite databases with strict named parameter binding", () => {
    const db = openSqliteDatabase(":memory:");
    try {
      const row = db.prepare("SELECT $value AS value").get({ value: "ok" }) as {
        value: string;
      };

      expect(row.value).toBe("ok");
    } finally {
      db.close();
    }
  });
});
