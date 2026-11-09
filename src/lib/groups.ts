import { Directory, File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';

import { getDb, newId, now } from '@/db';
import { addCourse, getProfile } from '@/db/repo';
import { getStudyPack, saveStudyPack } from '@/db/study';
import { supabase } from '@/lib/supabase';
import { syncNow } from '@/lib/sync';

/**
 * Study groups. Online: create/join/share. Offline: everything already fetched
 * is cached on the phone, and downloaded lectures are ordinary local lectures
 * (own recall schedule, quizzes, files) — no internet needed to study them.
 *
 * Downloaded lectures are device-local copies: they are never pushed to the
 * student's own cloud backup (the original lives with the sharer).
 */

const BUCKET = 'lecture-files';

export type Member = { user_id: string; display_name: string; role: 'owner' | 'member' };
export type Group = { id: string; name: string; invite_code: string; owner_id: string; members: Member[] };

export type ShareFile = {
  storage_path: string;
  kind: 'audio' | 'slide' | 'photo';
  name: string | null;
  mime: string | null;
  seq: number;
  size_bytes: number | null;
  duration_ms: number | null;
};

export type Share = {
  id: string;
  group_id: string;
  shared_by: string;
  sharer_name: string;
  kind: 'lecture' | 'past_paper';
  title: string | null;
  course_code: string;
  course_title: string;
  date: string;
  notes: string | null;
  pack: {
    summary: string;
    key_points: string[];
    emphasised: string[];
    topics: string[];
    cards: { topic: string | null; front: string; back: string }[];
    questions: { topic: string | null; question: string; options: string[]; answer_index: number; explanation: string; source: string }[];
  } | null;
  files: ShareFile[];
  created_at: string;
};

export class GroupError extends Error {
  constructor(public code: 'signed-out' | 'offline' | 'bad-code' | 'not-uploaded' | 'empty') {
    super(code);
  }
}

export const inviteLink = (code: string) => `recall://group/join?code=${code}`;

async function online() {
  const n = await Network.getNetworkStateAsync();
  return !!n.isConnected && n.isInternetReachable !== false;
}

async function requireUser(): Promise<string> {
  if (!supabase) throw new GroupError('signed-out');
  const uid = (await supabase.auth.getSession()).data.session?.user.id;
  if (!uid) throw new GroupError('signed-out');
  if (!(await online())) throw new GroupError('offline');
  return uid;
}

async function myName() {
  return (await getProfile())?.name ?? 'Student';
}

// ---------------- offline cache ----------------

export async function cachedGroups(): Promise<Group[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM group_cache ORDER BY name');
  return rows.map((r) => ({ ...r, members: JSON.parse(r.members) }));
}

export async function cachedGroup(id: string): Promise<Group | null> {
  return (await cachedGroups()).find((g) => g.id === id) ?? null;
}

export async function cachedShares(groupId: string): Promise<Share[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ data: string }>(
    'SELECT data FROM group_share_cache WHERE group_id = ? ORDER BY created_at DESC',
    groupId,
  );
  return rows.map((r) => JSON.parse(r.data));
}

/** share_id → local lecture id, for shares already on this phone. */
export async function downloadedMap(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ share_id: string; lecture_id: string }>(
    'SELECT d.share_id, d.lecture_id FROM group_downloads d JOIN lectures l ON l.id = d.lecture_id WHERE l.deleted = 0',
  );
  return Object.fromEntries(rows.map((r) => [r.share_id, r.lecture_id]));
}

/** Lecture ids that came from a group (excluded from the student's own backup). */
export async function downloadedLectureIds(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ lecture_id: string }>('SELECT lecture_id FROM group_downloads');
  return new Set(rows.map((r) => r.lecture_id));
}

// ---------------- refresh from cloud ----------------

/** Pulls the student's groups (and each group's shares) into the cache. No-ops offline. */
export async function refreshGroups(): Promise<boolean> {
  if (!supabase) return false;
  const uid = (await supabase.auth.getSession()).data.session?.user.id;
  if (!uid || !(await online())) return false;
  const sb = supabase;

  const { data: mine, error: e1 } = await sb.from('group_members').select('group_id').eq('user_id', uid);
  if (e1) throw e1;
  const ids = (mine ?? []).map((m) => m.group_id as string);

  const db = await getDb();
  if (!ids.length) {
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM group_cache');
      await db.runAsync('DELETE FROM group_share_cache');
    });
    return true;
  }

  const [groups, members, shares] = await Promise.all([
    sb.from('groups').select('id, name, invite_code, owner_id').in('id', ids),
    sb.from('group_members').select('group_id, user_id, display_name, role').in('group_id', ids),
    sb.from('group_shares').select('*').in('group_id', ids).order('created_at', { ascending: false }),
  ]);
  if (groups.error) throw groups.error;
  if (members.error) throw members.error;
  if (shares.error) throw shares.error;

  const stamp = now();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM group_cache');
    await db.runAsync('DELETE FROM group_share_cache');
    for (const g of groups.data ?? []) {
      const ms = (members.data ?? []).filter((m) => m.group_id === g.id).map(({ user_id, display_name, role }) => ({ user_id, display_name, role }));
      await db.runAsync(
        'INSERT INTO group_cache (id, name, invite_code, owner_id, members, fetched_at) VALUES (?, ?, ?, ?, ?, ?)',
        g.id, g.name, g.invite_code, g.owner_id, JSON.stringify(ms), stamp,
      );
    }
    for (const s of shares.data ?? []) {
      await db.runAsync(
        'INSERT INTO group_share_cache (id, group_id, data, created_at) VALUES (?, ?, ?, ?)',
        s.id, s.group_id, JSON.stringify(s), s.created_at,
      );
    }
  });
  return true;
}

// ---------------- create / join / leave ----------------

export async function createGroup(name: string): Promise<string> {
  await requireUser();
  const { data, error } = await supabase!.rpc('create_group', { p_name: name.trim(), p_display_name: await myName() });
  if (error) throw error;
  await refreshGroups();
  return (data as { id: string }).id;
}

export async function joinGroup(code: string): Promise<string> {
  await requireUser();
  const { data, error } = await supabase!.rpc('join_group', { p_code: code.trim().toUpperCase(), p_display_name: await myName() });
  if (error) throw error;
  if (!data) throw new GroupError('bad-code');
  await refreshGroups();
  return data as string;
}

export async function leaveGroup(groupId: string) {
  const uid = await requireUser();
  const g = await cachedGroup(groupId);
  const q = g?.owner_id === uid
    ? supabase!.from('groups').delete().eq('id', groupId) // owner leaving closes the group
    : supabase!.from('group_members').delete().eq('group_id', groupId).eq('user_id', uid);
  const { error } = await q;
  if (error) throw error;
  await refreshGroups();
}

export async function removeShare(shareId: string) {
  await requireUser();
  const { error } = await supabase!.from('group_shares').delete().eq('id', shareId);
  if (error) throw error;
  await refreshGroups();
}

// ---------------- share a lecture ----------------

/** Lectures the student can share: their own (not group downloads) with files or a study pack. */
export async function shareableLectures() {
  const db = await getDb();
  return db.getAllAsync<{ id: string; title: string | null; date: string; kind: string; status: string; code: string; files: number }>(
    `SELECT l.id, l.title, l.date, l.kind, l.status, c.code,
       (SELECT COUNT(*) FROM assets a WHERE a.lecture_id = l.id) files
     FROM lectures l JOIN courses c ON c.id = l.course_id
     WHERE l.deleted = 0 AND c.deleted = 0
       AND l.id NOT IN (SELECT lecture_id FROM group_downloads)
       AND (l.status = 'ready' OR EXISTS (SELECT 1 FROM assets a WHERE a.lecture_id = l.id))
     ORDER BY l.date DESC`,
  );
}

export async function shareLecture(groupId: string, lectureId: string, withRecordings: boolean) {
  const uid = await requireUser();
  // Make sure the lecture's files are in the cloud so classmates can download them.
  await syncNow();
  const db = await getDb();
  const l = await db.getFirstAsync<any>(
    'SELECT l.*, c.code, c.title course_title FROM lectures l JOIN courses c ON c.id = l.course_id WHERE l.id = ?',
    lectureId,
  );
  if (!l) throw new GroupError('empty');

  const assets = await db.getAllAsync<any>(
    `SELECT * FROM assets WHERE lecture_id = ? ${withRecordings ? '' : "AND kind != 'audio'"} ORDER BY kind, seq`,
    lectureId,
  );
  if (assets.some((a) => a.upload_state !== 'uploaded' || !a.remote_url)) throw new GroupError('not-uploaded');
  const files: ShareFile[] = assets.map((a) => ({
    storage_path: a.remote_url, kind: a.kind, name: a.name, mime: a.mime, seq: a.seq, size_bytes: a.size_bytes, duration_ms: a.duration_ms,
  }));

  const sp = await getStudyPack(lectureId);
  let pack: Share['pack'] = null;
  if (sp) {
    const cards = await db.getAllAsync<any>('SELECT topic, front, back FROM cards WHERE lecture_id = ?', lectureId);
    const qs = await db.getAllAsync<any>(
      'SELECT topic, question, options, answer_index, explanation, source FROM questions WHERE lecture_id = ?',
      lectureId,
    );
    pack = {
      summary: sp.summary, key_points: sp.key_points, emphasised: sp.emphasised, topics: sp.topics,
      cards, questions: qs.map((q) => ({ ...q, options: JSON.parse(q.options) })),
    };
  }
  if (!pack && !files.length) throw new GroupError('empty');

  const { error } = await supabase!.from('group_shares').insert({
    group_id: groupId,
    shared_by: uid,
    sharer_name: await myName(),
    kind: l.kind,
    title: l.title,
    course_code: l.code,
    course_title: l.course_title,
    date: l.date,
    notes: l.notes,
    pack,
    files,
  });
  if (error) throw error;
  await refreshGroups();
}

// ---------------- download for offline ----------------

export const shareSize = (s: Share) => s.files.reduce((n, f) => n + (f.size_bytes ?? 0), 0);

/**
 * Copies a shared lecture onto this phone: its course (matched by code, or
 * created), the lecture, its files and its study pack — with fresh card ids so
 * the student gets their own recall schedule. Returns the local lecture id.
 */
export async function downloadShare(share: Share): Promise<string> {
  await requireUser();
  const db = await getDb();
  const existing = (await downloadedMap())[share.id];
  if (existing) return existing;

  let course = await db.getFirstAsync<{ id: string }>('SELECT id FROM courses WHERE code = ? AND deleted = 0', share.course_code);
  const courseId = course?.id ?? (await addCourse({ code: share.course_code, title: share.course_title, lecturer: null, units: null }));

  const lectureId = newId();
  const title = share.title ? `${share.title} · ${share.sharer_name}` : share.sharer_name;
  const dir = new Directory(Paths.document, 'lectures', lectureId);
  if (!dir.exists) dir.create({ intermediates: true });

  // Download files first; nothing is written to the database until they're all here.
  const got: (ShareFile & { local_uri: string; id: string })[] = [];
  try {
    for (const f of share.files) {
      const { data, error } = await supabase!.storage.from(BUCKET).createSignedUrl(f.storage_path, 600);
      if (error || !data) throw error ?? new Error('no url');
      const id = newId();
      const ext = f.storage_path.split('.').pop() ?? 'bin';
      const file = await File.downloadFileAsync(data.signedUrl, new File(dir, `${id}.${ext}`));
      got.push({ ...f, id, local_uri: file.uri });
    }
  } catch (e) {
    try { dir.delete(); } catch { /* ignore */ }
    throw e;
  }

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO lectures (id, course_id, slot_id, date, title, notes, kind, status, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)',
      lectureId, courseId, share.date, title, share.notes, share.kind, 'captured', now(),
    );
    for (const f of got) {
      await db.runAsync(
        `INSERT INTO assets (id, lecture_id, kind, local_uri, remote_url, upload_state, name, mime, seq, size_bytes, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, 'uploaded', ?, ?, ?, ?, ?, ?)`,
        f.id, lectureId, f.kind, f.local_uri, f.storage_path, f.name, f.mime, f.seq, f.size_bytes, f.duration_ms, now(),
      );
    }
    await db.runAsync('INSERT INTO group_downloads (share_id, lecture_id, downloaded_at) VALUES (?, ?, ?)', share.id, lectureId, now());
  });

  if (share.pack) {
    const p = share.pack;
    await saveStudyPack(
      { lecture_id: lectureId, summary: p.summary, key_points: p.key_points, emphasised: p.emphasised, topics: p.topics },
      p.cards.map((c) => ({ id: newId(), course_id: courseId, ...c })),
      p.questions.map((q) => ({ id: newId(), course_id: courseId, ...q })),
    );
  }
  return lectureId;
}
