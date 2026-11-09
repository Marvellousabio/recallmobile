import { enqueueChange, getDb, newId, now } from './index';

export type Profile = {
  id: string;
  name: string;
  university: string | null;
  department: string | null;
  level: string | null;
  language: string;
  interests: string[];
  analogies_enabled: boolean;
  onboarded: boolean;
};

export type Course = {
  id: string;
  code: string;
  title: string;
  lecturer: string | null;
  units: number | null;
  color: string;
};

export type Slot = {
  id: string;
  course_id: string;
  weekday: number;
  start_min: number;
  end_min: number;
  venue: string | null;
};

export type SlotWithCourse = Slot & { code: string; title: string; color: string };

const COURSE_COLORS = ['#2F7D5B', '#C4622D', '#3A5BA0', '#8E4BA8', '#B8892A', '#2A8C99', '#B0425A'];

// ---------- profile ----------

export async function getProfile(): Promise<Profile | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<any>('SELECT * FROM profile LIMIT 1');
  if (!r) return null;
  return {
    ...r,
    interests: JSON.parse(r.interests),
    analogies_enabled: !!r.analogies_enabled,
    onboarded: !!r.onboarded,
  };
}

export async function saveProfile(p: Omit<Profile, 'id'> & { id?: string }): Promise<string> {
  const db = await getDb();
  const id = p.id ?? (await getProfile())?.id ?? newId();
  await db.runAsync(
    `INSERT INTO profile (id, name, university, department, level, language, interests, analogies_enabled, onboarded, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, university=excluded.university,
       department=excluded.department, level=excluded.level, language=excluded.language,
       interests=excluded.interests, analogies_enabled=excluded.analogies_enabled,
       onboarded=excluded.onboarded, updated_at=excluded.updated_at`,
    id, p.name, p.university, p.department, p.level, p.language,
    JSON.stringify(p.interests), p.analogies_enabled ? 1 : 0, p.onboarded ? 1 : 0, now(),
  );
  await enqueueChange(db, 'profile', id, 'upsert');
  return id;
}

// ---------- courses ----------

export async function listCourses(): Promise<Course[]> {
  const db = await getDb();
  return db.getAllAsync<Course>('SELECT id, code, title, lecturer, units, color FROM courses WHERE deleted = 0 ORDER BY code');
}

export async function getCourse(id: string): Promise<Course | null> {
  const db = await getDb();
  return db.getFirstAsync<Course>('SELECT id, code, title, lecturer, units, color FROM courses WHERE id = ?', id);
}

export async function addCourse(c: Omit<Course, 'id' | 'color'>): Promise<string> {
  const db = await getDb();
  const id = newId();
  const count = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM courses'))?.n ?? 0;
  await db.runAsync(
    'INSERT INTO courses (id, code, title, lecturer, units, color, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, c.code.trim().toUpperCase(), c.title.trim(), c.lecturer, c.units,
    COURSE_COLORS[count % COURSE_COLORS.length], now(),
  );
  await enqueueChange(db, 'courses', id, 'upsert');
  return id;
}

export async function deleteCourse(id: string) {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE courses SET deleted = 1, updated_at = ? WHERE id = ?', now(), id);
    await db.runAsync('UPDATE timetable_slots SET deleted = 1, updated_at = ? WHERE course_id = ?', now(), id);
    await enqueueChange(db, 'courses', id, 'delete');
  });
}

// ---------- timetable ----------

export async function listSlots(courseId?: string): Promise<SlotWithCourse[]> {
  const db = await getDb();
  const where = courseId ? 'AND s.course_id = ?' : '';
  const args = courseId ? [courseId] : [];
  return db.getAllAsync<SlotWithCourse>(
    `SELECT s.id, s.course_id, s.weekday, s.start_min, s.end_min, s.venue, c.code, c.title, c.color
     FROM timetable_slots s JOIN courses c ON c.id = s.course_id
     WHERE s.deleted = 0 AND c.deleted = 0 ${where}
     ORDER BY s.weekday, s.start_min`,
    ...args,
  );
}

export async function addSlot(s: Omit<Slot, 'id'>): Promise<string> {
  const db = await getDb();
  const id = newId();
  await db.runAsync(
    'INSERT INTO timetable_slots (id, course_id, weekday, start_min, end_min, venue, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, s.course_id, s.weekday, s.start_min, s.end_min, s.venue, now(),
  );
  await enqueueChange(db, 'timetable_slots', id, 'upsert');
  return id;
}

export async function deleteSlot(id: string) {
  const db = await getDb();
  await db.runAsync('UPDATE timetable_slots SET deleted = 1, updated_at = ? WHERE id = ?', now(), id);
  await enqueueChange(db, 'timetable_slots', id, 'delete');
}

export const formatTime = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
