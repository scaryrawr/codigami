import { Database } from "bun:sqlite";
import { type CodeUnit, type IndexStore, type StoredEmbedding } from "../types.ts";
import type { SqliteDatabase } from "./sqlite-database.ts";

const initializeDatabase = (db: SqliteDatabase): void => {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
};

const createStore = (db: SqliteDatabase, closeDatabase: boolean): IndexStore => {
  initializeDatabase(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS code_units (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      unit_type TEXT NOT NULL,
      name TEXT,
      source TEXT NOT NULL,
      language TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      unit_id TEXT PRIMARY KEY REFERENCES code_units(id) ON DELETE CASCADE,
      vector BLOB NOT NULL
    );
  `);

  const upsertUnit = db.prepare(`
    INSERT OR REPLACE INTO code_units (id, file_path, start_line, end_line, unit_type, name, source, language)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `);

  const upsertEmbedding = db.prepare(`
    INSERT OR REPLACE INTO embeddings (unit_id, vector)
    VALUES (?1, ?2)
  `);

  const selectAllWithEmbeddings = db.prepare(`
    SELECT
      code_units.id,
      code_units.file_path,
      code_units.start_line,
      code_units.end_line,
      code_units.unit_type,
      code_units.name,
      code_units.source,
      code_units.language,
      embeddings.vector
    FROM code_units
    JOIN embeddings ON code_units.id = embeddings.unit_id
  `);

  const upsertUnits = db.transaction((units: CodeUnit[]) => {
    for (const unit of units) {
      upsertUnit.run(
        unit.id,
        unit.filePath,
        unit.startLine,
        unit.endLine,
        unit.unitType,
        unit.name,
        unit.source,
        unit.language,
      );
    }
  });

  const deleteByFilePath = db.prepare("DELETE FROM code_units WHERE file_path = ?1");

  const storeEmbeddings = db.transaction((entries: StoredEmbedding[]) => {
    for (const entry of entries) {
      const float32 = new Float32Array(entry.embedding);
      const vector = new Uint8Array(float32.buffer);
      upsertEmbedding.run(entry.unitId, vector);
    }
  });

  const replaceFileUnitsWithEmbeddings = db.transaction(
    (filePaths: string[], units: CodeUnit[], entries: StoredEmbedding[]) => {
      for (const filePath of filePaths) {
        deleteByFilePath.run(filePath);
      }

      for (const unit of units) {
        upsertUnit.run(
          unit.id,
          unit.filePath,
          unit.startLine,
          unit.endLine,
          unit.unitType,
          unit.name,
          unit.source,
          unit.language,
        );
      }

      for (const entry of entries) {
        const float32 = new Float32Array(entry.embedding);
        const vector = new Uint8Array(float32.buffer);
        upsertEmbedding.run(entry.unitId, vector);
      }
    },
  );

  const getAllWithEmbeddings = (): { unit: CodeUnit; embedding: number[] }[] => {
    const rows = selectAllWithEmbeddings.all() as Array<{
      id: string;
      file_path: string;
      start_line: number;
      end_line: number;
      unit_type: string;
      name: string | null;
      source: string;
      language: string;
      vector: Uint8Array;
    }>;

    return rows.map((row) => ({
      unit: {
        id: row.id,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        unitType: row.unit_type,
        name: row.name,
        source: row.source,
        language: row.language,
      },
      embedding: Array.from(
        new Float32Array(
          row.vector.buffer,
          row.vector.byteOffset,
          row.vector.byteLength / Float32Array.BYTES_PER_ELEMENT,
        ),
      ),
    }));
  };

  const deleteByFilePaths = db.transaction((filePaths: string[]) => {
    for (const filePath of filePaths) {
      deleteByFilePath.run(filePath);
    }
  });

  const clear = (): void => {
    db.exec("DELETE FROM embeddings; DELETE FROM code_units;");
  };

  const close = (): void => {
    if (closeDatabase) {
      db.close();
    }
  };

  return {
    upsertUnits,
    storeEmbeddings,
    replaceFileUnitsWithEmbeddings,
    getAllWithEmbeddings,
    deleteByFilePaths,
    clear,
    close,
  };
};

export const createSqliteStoreFromDatabase = (db: SqliteDatabase): IndexStore => {
  return createStore(db, false);
};

export const createSqliteStore = (dbPath: string): IndexStore => {
  return createStore(new Database(dbPath, { strict: true }), true);
};
