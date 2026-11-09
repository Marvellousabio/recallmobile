import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';

import { MIGRATIONS } from './migrations';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Opens the on-device database and applies pending migrations once. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('recall.db');
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      let version = row?.user_version ?? 0;
      for (; version < MIGRATIONS.length; version++) {
        await db.withTransactionAsync(async () => {
          await db.execAsync(MIGRATIONS[version]);
          await db.execAsync(`PRAGMA user_version = ${version + 1}`);
        });
      }
      return db;
    })();
  }
  return dbPromise;
}

export const newId = () => randomUUID();
export const now = () => new Date().toISOString();

/**
 * Records a local change so the sync engine can push it when online.
 * Every write to a synced table must go through this.
 */
export async function enqueueChange(
  db: SQLite.SQLiteDatabase,
  table: string,
  rowId: string,
  op: 'upsert' | 'delete',
) {
  await db.runAsync(
    'INSERT INTO sync_outbox (id, table_name, row_id, op, created_at) VALUES (?, ?, ?, ?, ?)',
    newId(),
    table,
    rowId,
    op,
    now(),
  );
}
