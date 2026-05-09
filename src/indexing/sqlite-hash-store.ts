import Database from "better-sqlite3";
import type { FileHashStore } from "../types.ts";

export const createSqliteHashStore = (db: InstanceType<typeof Database>): FileHashStore => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_hashes (
      file_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL
    );
  `);

  const upsertHash = db.prepare(`
    INSERT OR REPLACE INTO file_hashes (file_path, content_hash)
    VALUES (@filePath, @contentHash)
  `);

  const selectAll = db.prepare("SELECT file_path, content_hash FROM file_hashes");

  const deleteByPath = db.prepare("DELETE FROM file_hashes WHERE file_path = @filePath");

  const getHashes = (): Map<string, string> => {
    const rows = selectAll.all() as Array<{ file_path: string; content_hash: string }>;
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.file_path, row.content_hash);
    }
    return map;
  };

  const setHash = (filePath: string, hash: string): void => {
    upsertHash.run({ filePath, contentHash: hash });
  };

  const removeFiles = db.transaction((filePaths: string[]) => {
    for (const filePath of filePaths) {
      deleteByPath.run({ filePath });
    }
  });

  const close = (): void => {
    // Do not close the shared database — the owner manages its lifecycle
  };

  return {
    getHashes,
    setHash,
    removeFiles,
    close,
  };
};
