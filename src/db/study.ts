import { Card as FsrsCard, createEmptyCard, fsrs, Grade, Rating, State } from 'ts-fsrs';

import { getDb, newId, now } from './index';

/** 90% target retention; fuzz spreads reviews so they don't all land on one day. */
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true });

export { Rating };

export type StudyPack = {
  lecture_id: string;
  summary: string;
  key_points: string[];
  emphasised: string[];
  topics: string[];
};

export type StudyCard = {
  id: string;
  lecture_id: string;
  course_id: string;
  topic: string | null;
  front: string;
  back: string;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
};

export type Question = {
  id: string;
  lecture_id: string;
  topic: string | null;
  question: string;
  options: string[];
  answer_index: number;
  explanation: string;
  source: 'generated' | 'past';
};

export type DueByCourse = { course_id: string; code: string; color: string; due: number };

// ---------- writing AI output pulled from the server ----------

/**
 * First recall is due 30 minutes after the class ends (the forgetting curve is
 * steepest in the first hour) — or right away if that time has passed.
 */
export async function firstDueFor(lectureId: string): Promise<Date> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ date: string; end_min: number | null }>(
    `SELECT l.date, s.end_min FROM lectures l LEFT JOIN timetable_slots s ON s.id = l.slot_id WHERE l.id = ?`,
    lectureId,
  );
  const nowD = new Date();
  if (!r) return nowD;
  const d = new Date(`${r.date}T00:00:00`);
  d.setMinutes((r.end_min ?? nowD.getHours() * 60 + nowD.getMinutes()) + 30);
  return d > nowD ? d : nowD;
}

export async function saveStudyPack(
  pack: StudyPack,
  cards: { id: string; course_id: string; topic: string | null; front: string; back: string }[],
  questions: { id: string; course_id: string; topic: string | null; question: string; options: string[]; answer_index: number; explanation: string; source?: string }[],
) {
  const db = await getDb();
  const due = (await firstDueFor(pack.lecture_id)).toISOString();
  const empty = createEmptyCard(new Date(due));
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO lecture_ai (lecture_id, summary, key_points, emphasised, topics, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      pack.lecture_id, pack.summary, JSON.stringify(pack.key_points), JSON.stringify(pack.emphasised), JSON.stringify(pack.topics), now(),
    );
    // Reprocessing replaces cards; keep scheduling state for any card that survives.
    const ids = cards.map((c) => c.id);
    await db.runAsync(
      `DELETE FROM cards WHERE lecture_id = ? AND id NOT IN (${ids.map(() => '?').join(',') || "''"})`,
      pack.lecture_id, ...ids,
    );
    for (const c of cards) {
      await db.runAsync(
        `INSERT INTO cards (id, lecture_id, course_id, topic, front, back, due, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET topic = excluded.topic, front = excluded.front, back = excluded.back`,
        c.id, pack.lecture_id, c.course_id, c.topic, c.front, c.back, due, empty.state,
      );
    }
    await db.runAsync('DELETE FROM questions WHERE lecture_id = ?', pack.lecture_id);
    for (const q of questions) {
      await db.runAsync(
        `INSERT INTO questions (id, lecture_id, course_id, topic, question, options, answer_index, explanation, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        q.id, pack.lecture_id, q.course_id, q.topic, q.question, JSON.stringify(q.options), q.answer_index, q.explanation, q.source ?? 'generated',
      );
    }
    await db.runAsync("UPDATE lectures SET status = 'ready' WHERE id = ?", pack.lecture_id);
  });
}

// ---------- reading ----------

export async function getStudyPack(lectureId: string): Promise<StudyPack | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<any>('SELECT * FROM lecture_ai WHERE lecture_id = ?', lectureId);
  if (!r) return null;
  return {
    lecture_id: r.lecture_id,
    summary: r.summary,
    key_points: JSON.parse(r.key_points),
    emphasised: JSON.parse(r.emphasised),
    topics: JSON.parse(r.topics),
  };
}

export async function countCards(lectureId: string) {
  const db = await getDb();
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM cards WHERE lecture_id = ?', lectureId))?.n ?? 0;
}

export async function dueByCourse(at = new Date()): Promise<DueByCourse[]> {
  const db = await getDb();
  return db.getAllAsync<DueByCourse>(
    `SELECT c.course_id, co.code, co.color, COUNT(*) due FROM cards c JOIN courses co ON co.id = c.course_id
     WHERE c.due <= ? AND co.deleted = 0 GROUP BY c.course_id ORDER BY due DESC`,
    at.toISOString(),
  );
}

export async function dueCards(opts: { courseId?: string; lectureId?: string; limit?: number } = {}): Promise<StudyCard[]> {
  const db = await getDb();
  const where = ['c.due <= ?', 'co.deleted = 0'];
  const args: (string | number)[] = [new Date().toISOString()];
  if (opts.courseId) { where.push('c.course_id = ?'); args.push(opts.courseId); }
  if (opts.lectureId) { where.length = 1; where[0] = 'c.lecture_id = ?'; args[0] = opts.lectureId; } // lecture review = all its cards
  return db.getAllAsync<StudyCard>(
    `SELECT c.* FROM cards c JOIN courses co ON co.id = c.course_id WHERE ${where.join(' AND ')} ORDER BY c.due LIMIT ?`,
    ...args, opts.limit ?? 50,
  );
}

export async function listQuestions(lectureId: string): Promise<Question[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM questions WHERE lecture_id = ?', lectureId);
  return rows.map((r) => ({ ...r, options: JSON.parse(r.options) }));
}

/**
 * Quiz set. `mock` mixes the whole course, favouring questions the student
 * got wrong before and ones never attempted.
 */
export async function quizQuestions(opts: { lectureId?: string; courseId?: string; limit?: number }): Promise<Question[]> {
  const db = await getDb();
  const where = opts.lectureId ? 'q.lecture_id = ?' : 'q.course_id = ?';
  const rows = await db.getAllAsync<any>(
    `SELECT q.*,
       (SELECT COUNT(*) FROM quiz_attempts a WHERE a.question_id = q.id) tries,
       (SELECT COUNT(*) FROM quiz_attempts a WHERE a.question_id = q.id AND a.correct = 0) misses
     FROM questions q JOIN lectures l ON l.id = q.lecture_id
     WHERE ${where} AND l.deleted = 0
     ORDER BY misses DESC, tries ASC, RANDOM() LIMIT ?`,
    opts.lectureId ?? opts.courseId!, opts.limit ?? 20,
  );
  return rows.map((r) => ({ ...r, options: JSON.parse(r.options) }));
}

export async function recordAttempt(questionId: string, correct: boolean) {
  const db = await getDb();
  await db.runAsync('INSERT INTO quiz_attempts (id, question_id, correct, at) VALUES (?, ?, ?, ?)', newId(), questionId, correct ? 1 : 0, now());
}

/** Share of a course's cards the student holds well (FSRS stability ≥ 7 days). */
export async function courseMastery(courseId: string): Promise<{ total: number; strong: number; weak: number }> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ total: number; strong: number; weak: number }>(
    `SELECT COUNT(*) total,
       COALESCE(SUM(CASE WHEN reps > 0 AND stability >= 7 THEN 1 ELSE 0 END), 0) strong,
       COALESCE(SUM(CASE WHEN lapses > 0 OR (reps > 0 AND stability < 2) THEN 1 ELSE 0 END), 0) weak
     FROM cards c JOIN lectures l ON l.id = c.lecture_id WHERE c.course_id = ? AND l.deleted = 0`,
    courseId,
  );
  return r ?? { total: 0, strong: 0, weak: 0 };
}

/** Weak cards for "fix weak spots" sessions, regardless of due date. */
export async function weakCards(courseId: string, limit = 30): Promise<StudyCard[]> {
  const db = await getDb();
  return db.getAllAsync<StudyCard>(
    `SELECT * FROM cards WHERE course_id = ? AND (lapses > 0 OR (reps > 0 AND stability < 2) OR reps = 0)
     ORDER BY lapses DESC, stability ASC LIMIT ?`,
    courseId, limit,
  );
}

// ---------- reviewing (FSRS) ----------

function toFsrs(c: StudyCard): FsrsCard {
  return {
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as State,
    last_review: c.last_review ? new Date(c.last_review) : undefined,
  };
}

/** Next due date for each rating — shown on the buttons ("10m", "1d", "4d"…). */
export function previewIntervals(c: StudyCard, at = new Date()): Record<Grade, Date> {
  const p = scheduler.repeat(toFsrs(c), at);
  return {
    [Rating.Again]: p[Rating.Again].card.due,
    [Rating.Hard]: p[Rating.Hard].card.due,
    [Rating.Good]: p[Rating.Good].card.due,
    [Rating.Easy]: p[Rating.Easy].card.due,
  } as Record<Grade, Date>;
}

export async function reviewCard(c: StudyCard, rating: Grade, at = new Date()) {
  const db = await getDb();
  const { card } = scheduler.next(toFsrs(c), at, rating);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?, scheduled_days = ?, learning_steps = ?,
         reps = ?, lapses = ?, state = ?, last_review = ? WHERE id = ?`,
      card.due.toISOString(), card.stability, card.difficulty, card.elapsed_days, card.scheduled_days, card.learning_steps,
      card.reps, card.lapses, card.state, at.toISOString(), c.id,
    );
    await db.runAsync(
      'INSERT INTO review_logs (id, card_id, rating, state, reviewed_at, next_due) VALUES (?, ?, ?, ?, ?, ?)',
      newId(), c.id, rating, c.state, at.toISOString(), card.due.toISOString(),
    );
  });
  const updated: StudyCard = {
    ...c,
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: at.toISOString(),
  };
  return updated;
}

export const formatInterval = (due: Date, from = new Date()) => {
  const min = Math.max(1, Math.round((due.getTime() - from.getTime()) / 60000));
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d}d`;
  return `${Math.round(d / 30)}mo`;
};

export async function saveRecallDump(lectureId: string, text: string) {
  const db = await getDb();
  await db.runAsync('UPDATE lectures SET recall_dump = ?, updated_at = ? WHERE id = ?', text, now(), lectureId);
}
