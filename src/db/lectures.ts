import { Directory, File, Paths } from 'expo-file-system';

import { enqueueChange, getDb, newId, now } from './index';

export type Lecture = {
  id: string;
  course_id: string;
  slot_id: string | null;
  date: string;
  title: string | null;
  notes: string | null;
  status: string;
  recall_dump: string | null;
  kind: 'lecture' | 'past_paper';
};

export type LectureSummary = Lecture & { audio_count: number; slide_count: number; audio_ms: number };

export type AssetKind = 'audio' | 'slide' | 'photo';

export type Asset = {
  id: string;
  lecture_id: string;
  kind: AssetKind;
  local_uri: string;
  name: string | null;
  mime: string | null;
  seq: number;
  size_bytes: number | null;
  duration_ms: number | null;
  upload_state: string;
};

export const todayISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Returns the lecture for this course/slot/date, creating it if needed. */
export async function openLecture(courseId: string, slotId: string | null, date = todayISO()): Promise<string> {
  const db = await getDb();
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM lectures WHERE course_id = ? AND slot_id IS ? AND date = ? AND deleted = 0 AND kind = 'lecture'",
    courseId, slotId, date,
  );
  if (existing) return existing.id;
  const id = newId();
  await db.runAsync(
    'INSERT INTO lectures (id, course_id, slot_id, date, updated_at) VALUES (?, ?, ?, ?, ?)',
    id, courseId, slotId, date, now(),
  );
  await enqueueChange(db, 'lectures', id, 'upsert');
  return id;
}

/** A past question paper always gets its own row (several can share a date). */
export async function addPastPaper(courseId: string, title: string | null): Promise<string> {
  const db = await getDb();
  const id = newId();
  await db.runAsync(
    "INSERT INTO lectures (id, course_id, slot_id, date, title, kind, updated_at) VALUES (?, ?, NULL, ?, ?, 'past_paper', ?)",
    id, courseId, todayISO(), title, now(),
  );
  await enqueueChange(db, 'lectures', id, 'upsert');
  return id;
}

export async function getLecture(id: string): Promise<Lecture | null> {
  const db = await getDb();
  return db.getFirstAsync<Lecture>('SELECT * FROM lectures WHERE id = ?', id);
}

export async function listLectures(courseId: string): Promise<LectureSummary[]> {
  const db = await getDb();
  return db.getAllAsync<LectureSummary>(
    `SELECT l.*,
       (SELECT COUNT(*) FROM assets a WHERE a.lecture_id = l.id AND a.kind = 'audio') audio_count,
       (SELECT COUNT(*) FROM assets a WHERE a.lecture_id = l.id AND a.kind != 'audio') slide_count,
       (SELECT COALESCE(SUM(duration_ms), 0) FROM assets a WHERE a.lecture_id = l.id AND a.kind = 'audio') audio_ms
     FROM lectures l WHERE l.course_id = ? AND l.deleted = 0 ORDER BY l.date DESC`,
    courseId,
  );
}

export async function updateLecture(id: string, patch: { title?: string | null; notes?: string | null }) {
  const db = await getDb();
  const cur = await getLecture(id);
  if (!cur) return;
  await db.runAsync(
    'UPDATE lectures SET title = ?, notes = ?, updated_at = ? WHERE id = ?',
    patch.title !== undefined ? patch.title : cur.title,
    patch.notes !== undefined ? patch.notes : cur.notes,
    now(), id,
  );
  await enqueueChange(db, 'lectures', id, 'upsert');
}

// ---------- assets ----------

function lectureDir(lectureId: string) {
  const dir = new Directory(Paths.document, 'lectures', lectureId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * Moves a temp file (recording, picked document, camera photo) into the app's
 * permanent storage and records it. Files in cache can be purged by the OS.
 */
export async function addAsset(
  lectureId: string,
  kind: AssetKind,
  srcUri: string,
  meta: { name?: string | null; mime?: string | null; durationMs?: number | null } = {},
): Promise<Asset> {
  const db = await getDb();
  const id = newId();
  const src = new File(srcUri);
  const ext = (meta.name ?? srcUri).split('.').pop()?.split('?')[0] ?? 'bin';
  const dest = new File(lectureDir(lectureId), `${id}.${ext}`);
  src.copy(dest);
  try { src.delete(); } catch { /* picked files may be read-only; fine */ }

  const seqRow = await db.getFirstAsync<{ n: number }>(
    'SELECT COALESCE(MAX(seq), -1) + 1 n FROM assets WHERE lecture_id = ? AND kind = ?',
    lectureId, kind,
  );
  const asset: Asset = {
    id,
    lecture_id: lectureId,
    kind,
    local_uri: dest.uri,
    name: meta.name ?? null,
    mime: meta.mime ?? null,
    seq: seqRow?.n ?? 0,
    size_bytes: dest.size ?? null,
    duration_ms: meta.durationMs ?? null,
    upload_state: 'pending',
  };
  await db.runAsync(
    `INSERT INTO assets (id, lecture_id, kind, local_uri, name, mime, seq, size_bytes, duration_ms, upload_state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    asset.id, lectureId, kind, asset.local_uri, asset.name, asset.mime, asset.seq,
    asset.size_bytes, asset.duration_ms, now(),
  );
  await enqueueChange(db, 'assets', id, 'upsert');
  return asset;
}

export async function listAssets(lectureId: string): Promise<Asset[]> {
  const db = await getDb();
  return db.getAllAsync<Asset>(
    'SELECT id, lecture_id, kind, local_uri, name, mime, seq, size_bytes, duration_ms, upload_state FROM assets WHERE lecture_id = ? AND local_uri != \'\' ORDER BY kind, seq',
    lectureId,
  );
}

export async function deleteAsset(asset: Asset) {
  const db = await getDb();
  try { new File(asset.local_uri).delete(); } catch { /* already gone */ }
  await db.runAsync('DELETE FROM assets WHERE id = ?', asset.id);
  await enqueueChange(db, 'assets', asset.id, 'delete');
}

/** Queue AI processing for a lecture; runs when the device is online (M4). */
export async function queueProcessing(lectureId: string) {
  const db = await getDb();
  const pending = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM ai_jobs WHERE kind = 'process_lecture' AND ref_id = ? AND state = 'queued'",
    lectureId,
  );
  if (pending) return;
  await db.runAsync(
    "INSERT INTO ai_jobs (id, kind, ref_id, created_at) VALUES (?, 'process_lecture', ?, ?)",
    newId(), lectureId, now(),
  );
  await db.runAsync("UPDATE lectures SET status = 'queued', updated_at = ? WHERE id = ?", now(), lectureId);
}

export const formatDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

export const formatBytes = (b: number | null) =>
  b == null ? '' : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
