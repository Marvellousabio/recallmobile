import { Directory, File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';

import { getDb } from '@/db';
import { kvGet, kvSet } from '@/db/kv';
import { fetchStudyPack } from '@/lib/ai';
import { supabase } from '@/lib/supabase';

/**
 * Local-first sync.
 *  push: drain sync_outbox → upsert rows to Supabase, upload asset files to Storage.
 *  pull: fetch rows changed on other devices since last pull → merge (newer updated_at wins).
 * Safe to call any time; it no-ops when offline, signed out, or already running.
 */

const ROW_TABLES = ['courses', 'timetable_slots', 'lectures', 'exams'] as const;
const PUSH_ORDER = ['profile', 'courses', 'timetable_slots', 'lectures', 'assets', 'exams'];
const BUCKET = 'lecture-files';

export type SyncResult = { pushed: number; pulled: number; skipped?: 'offline' | 'wifi' | 'signed-out' | 'busy' };

let running = false;

export async function getWifiOnly() {
  return (await kvGet('wifi_only')) === '1';
}
export async function setWifiOnly(on: boolean) {
  await kvSet('wifi_only', on ? '1' : '0');
}
export async function getLastSync() {
  return kvGet('last_sync_at');
}
export async function pendingCount() {
  const db = await getDb();
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(DISTINCT table_name || row_id) n FROM sync_outbox'))?.n ?? 0;
}

export async function syncNow(): Promise<SyncResult> {
  if (!supabase) return { pushed: 0, pulled: 0, skipped: 'signed-out' };
  if (running) return { pushed: 0, pulled: 0, skipped: 'busy' };

  const net = await Network.getNetworkStateAsync();
  if (!net.isConnected || net.isInternetReachable === false) return { pushed: 0, pulled: 0, skipped: 'offline' };
  if ((await getWifiOnly()) && net.type !== Network.NetworkStateType.WIFI) return { pushed: 0, pulled: 0, skipped: 'wifi' };

  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return { pushed: 0, pulled: 0, skipped: 'signed-out' };

  running = true;
  try {
    const pushed = await push(userId);
    const pulled = await pull();
    await kvSet('last_sync_at', new Date().toISOString());
    return { pushed, pulled };
  } finally {
    running = false;
  }
}

// ---------------- push ----------------

async function push(userId: string): Promise<number> {
  const db = await getDb();
  // Collapse many edits of the same row into one push of its latest state.
  const items = await db.getAllAsync<{ table_name: string; row_id: string; op: string; last: string }>(
    `SELECT table_name, row_id,
       (SELECT op FROM sync_outbox o2 WHERE o2.table_name = o.table_name AND o2.row_id = o.row_id ORDER BY created_at DESC LIMIT 1) op,
       MAX(created_at) last
     FROM sync_outbox o GROUP BY table_name, row_id`,
  );
  items.sort((a, b) => PUSH_ORDER.indexOf(a.table_name) - PUSH_ORDER.indexOf(b.table_name));

  let done = 0;
  for (const it of items) {
    try {
      await pushOne(userId, it.table_name, it.row_id, it.op);
      await db.runAsync('DELETE FROM sync_outbox WHERE table_name = ? AND row_id = ? AND created_at <= ?', it.table_name, it.row_id, it.last);
      done++;
    } catch (e) {
      // Leave it in the outbox; next sync retries. Keep going with other rows.
      console.warn('[sync] push failed', it.table_name, it.row_id, e);
    }
  }
  return done;
}

async function pushOne(userId: string, table: string, rowId: string, op: string) {
  const db = await getDb();
  const sb = supabase!;

  if (table === 'profile') {
    const p = await db.getFirstAsync<any>('SELECT * FROM profile WHERE id = ?', rowId);
    if (!p) return;
    const { error } = await sb.from('profiles').upsert({
      id: userId,
      local_id: p.id,
      name: p.name,
      university: p.university,
      department: p.department,
      level: p.level,
      language: p.language,
      interests: JSON.parse(p.interests),
      analogies_enabled: !!p.analogies_enabled,
      updated_at: p.updated_at,
    });
    if (error) throw error;
    return;
  }

  if (table === 'assets') {
    if (op === 'delete') {
      const { data } = await sb.from('assets').select('storage_path').eq('id', rowId).maybeSingle();
      if (data?.storage_path) await sb.storage.from(BUCKET).remove([data.storage_path]);
      const { error } = await sb.from('assets').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', rowId);
      if (error) throw error;
      return;
    }
    const a = await db.getFirstAsync<any>('SELECT * FROM assets WHERE id = ?', rowId);
    if (!a) return;
    let path: string = a.remote_url;
    if (a.upload_state !== 'uploaded') {
      const file = new File(a.local_uri);
      if (!file.exists) return; // deleted locally before it ever uploaded
      const ext = a.local_uri.split('.').pop();
      path = `${userId}/${a.lecture_id}/${a.id}.${ext}`;
      const { error } = await sb.storage
        .from(BUCKET)
        .upload(path, await file.arrayBuffer(), { contentType: a.mime ?? 'application/octet-stream', upsert: true });
      if (error) throw error;
      await db.runAsync("UPDATE assets SET upload_state = 'uploaded', remote_url = ? WHERE id = ?", path, a.id);
    }
    const { error } = await sb.from('assets').upsert({
      id: a.id,
      user_id: userId,
      lecture_id: a.lecture_id,
      kind: a.kind,
      storage_path: path,
      name: a.name,
      mime: a.mime,
      seq: a.seq,
      size_bytes: a.size_bytes,
      duration_ms: a.duration_ms,
      updated_at: a.created_at,
    });
    if (error) throw error;
    return;
  }

  // Plain row tables are soft-deleted locally, so "delete" is just an upsert with deleted = true.
  const row = await db.getFirstAsync<any>(`SELECT * FROM ${table} WHERE id = ?`, rowId);
  if (!row) return;
  const out: Record<string, unknown> = { ...row, user_id: userId, deleted: !!row.deleted };
  const { error } = await sb.from(table).upsert(out);
  if (error) throw error;
}

// ---------------- pull ----------------

const COLUMNS: Record<(typeof ROW_TABLES)[number], string[]> = {
  courses: ['id', 'code', 'title', 'lecturer', 'units', 'color', 'deleted', 'updated_at'],
  timetable_slots: ['id', 'course_id', 'weekday', 'start_min', 'end_min', 'venue', 'deleted', 'updated_at'],
  lectures: ['id', 'course_id', 'slot_id', 'date', 'title', 'notes', 'status', 'kind', 'recall_dump', 'deleted', 'updated_at'],
  exams: ['id', 'course_id', 'kind', 'date', 'title', 'deleted', 'updated_at'],
};

async function pull(): Promise<number> {
  const db = await getDb();
  const sb = supabase!;
  const since = (await kvGet('last_pull_at')) ?? '1970-01-01T00:00:00Z';
  const startedAt = new Date().toISOString();
  let n = 0;

  for (const table of ROW_TABLES) {
    const cols = COLUMNS[table];
    const { data, error } = await sb.from(table).select(cols.join(',')).gt('updated_at', since).order('updated_at');
    if (error) throw error;
    for (const r of (data ?? []) as any[]) {
      const local = await db.getFirstAsync<{ updated_at: string }>(`SELECT updated_at FROM ${table} WHERE id = ?`, r.id);
      if (local && new Date(local.updated_at) >= new Date(r.updated_at)) continue; // local is newer — keep it
      // Don't overwrite a row that has unpushed local edits.
      const dirty = await db.getFirstAsync('SELECT 1 FROM sync_outbox WHERE table_name = ? AND row_id = ?', table, r.id);
      if (dirty) continue;
      const vals = cols.map((c) => (c === 'deleted' ? (r[c] ? 1 : 0) : r[c]));
      await db.runAsync(
        `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
         ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(',')}`,
        ...vals,
      );
      n++;
    }
  }
  n += await pullAssets(since);
  await restoreStudyPacks();
  await kvSet('last_pull_at', startedAt);
  return n;
}

/**
 * File metadata from other devices. The files themselves download on demand
 * (when the lecture is opened) — a new phone shouldn't burn data on every recording.
 */
async function pullAssets(since: string): Promise<number> {
  const db = await getDb();
  const { data, error } = await supabase!
    .from('assets')
    .select('id, lecture_id, kind, storage_path, name, mime, seq, size_bytes, duration_ms, deleted, updated_at')
    .gt('updated_at', since);
  if (error) throw error;
  let n = 0;
  for (const a of data ?? []) {
    const local = await db.getFirstAsync<{ id: string }>('SELECT id FROM assets WHERE id = ?', a.id);
    if (a.deleted) {
      if (local) await db.runAsync('DELETE FROM assets WHERE id = ?', a.id);
      continue;
    }
    if (local) continue;
    const hasLecture = await db.getFirstAsync('SELECT 1 FROM lectures WHERE id = ?', a.lecture_id);
    if (!hasLecture) continue;
    await db.runAsync(
      `INSERT INTO assets (id, lecture_id, kind, local_uri, remote_url, upload_state, name, mime, seq, size_bytes, duration_ms, created_at)
       VALUES (?, ?, ?, '', ?, 'uploaded', ?, ?, ?, ?, ?, ?)`,
      a.id, a.lecture_id, a.kind, a.storage_path, a.name, a.mime, a.seq, a.size_bytes, a.duration_ms, a.updated_at,
    );
    n++;
  }
  return n;
}

/** Lectures processed in the cloud but missing their study pack here (e.g. new phone). */
async function restoreStudyPacks() {
  const db = await getDb();
  const missing = await db.getAllAsync<{ id: string }>(
    "SELECT l.id FROM lectures l LEFT JOIN lecture_ai a ON a.lecture_id = l.id WHERE l.status = 'ready' AND a.lecture_id IS NULL AND l.deleted = 0",
  );
  for (const m of missing) {
    try {
      await fetchStudyPack(m.id);
    } catch (e) {
      console.warn('[sync] study pack restore failed', m.id, e);
    }
  }
}

/** Downloads any of a lecture's files that only exist in the cloud. Returns how many were fetched. */
export async function ensureLocalFiles(lectureId: string): Promise<number> {
  if (!supabase) return 0;
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; remote_url: string }>(
    "SELECT id, remote_url FROM assets WHERE lecture_id = ? AND local_uri = '' AND remote_url IS NOT NULL",
    lectureId,
  );
  if (!rows.length) return 0;
  if (await getWifiOnly()) {
    const net = await Network.getNetworkStateAsync();
    if (net.type !== Network.NetworkStateType.WIFI) return 0;
  }
  const dir = new Directory(Paths.document, 'lectures', lectureId);
  if (!dir.exists) dir.create({ intermediates: true });
  let n = 0;
  for (const r of rows) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(r.remote_url, 600);
      if (error || !data) continue;
      const dest = new File(dir, r.remote_url.split('/').pop()!);
      if (dest.exists) dest.delete();
      const file = await File.downloadFileAsync(data.signedUrl, dest);
      await db.runAsync('UPDATE assets SET local_uri = ? WHERE id = ?', file.uri, r.id);
      n++;
    } catch (e) {
      console.warn('[sync] download failed', r.id, e);
    }
  }
  return n;
}
