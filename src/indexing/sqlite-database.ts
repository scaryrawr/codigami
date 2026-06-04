import { Database } from "bun:sqlite";

export type SqliteDatabase = Database;

export const openSqliteDatabase = (dbPath: string): SqliteDatabase => {
  return new Database(dbPath, { strict: true });
};
