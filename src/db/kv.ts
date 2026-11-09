import { getDb } from './index';

export async function kvGet(key: string): Promise<string | null> {
  const db = await getDb();
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key))?.value ?? null;
}

export async function kvSet(key: string, value: string) {
  const db = await getDb();
  await db.runAsync('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
