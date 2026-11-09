import { enqueueChange, getDb, newId, now } from './index';
import { todayISO } from './lectures';
import { buildPlan, LectureStat, taskKey } from '@/lib/plan';

export type Exam = {
  id: string;
  course_id: string;
  kind: 'test' | 'exam';
  date: string; // YYYY-MM-DD
  title: string | null;
};

export type ExamWithCourse = Exam & { code: string; color: string };

export type PlanTask = {
  id: string;
  exam_id: string;
  date: string;
  kind: 'learn' | 'quiz' | 'past' | 'weak' | 'mock';
  ref_id: string | null;
  title: string;
  done: number;
};

export async function addExam(e: Omit<Exam, 'id'>): Promise<string> {
  const db = await getDb();
  const id = newId();
  await db.runAsync(
    'INSERT INTO exams (id, course_id, kind, date, title, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, e.course_id, e.kind, e.date, e.title, now(),
  );
  await enqueueChange(db, 'exams', id, 'upsert');
  await rebuildPlan(id);
  return id;
}

export async function deleteExam(id: string) {
  const db = await getDb();
  await db.runAsync('UPDATE exams SET deleted = 1, updated_at = ? WHERE id = ?', now(), id);
  await db.runAsync('DELETE FROM plan_tasks WHERE exam_id = ?', id);
  await enqueueChange(db, 'exams', id, 'delete');
}

export async function getExam(id: string): Promise<ExamWithCourse | null> {
  const db = await getDb();
  return db.getFirstAsync<ExamWithCourse>(
    'SELECT e.*, c.code, c.color FROM exams e JOIN courses c ON c.id = e.course_id WHERE e.id = ?',
    id,
  );
}

export async function upcomingExams(courseId?: string): Promise<ExamWithCourse[]> {
  const db = await getDb();
  return db.getAllAsync<ExamWithCourse>(
    `SELECT e.*, c.code, c.color FROM exams e JOIN courses c ON c.id = e.course_id
     WHERE e.deleted = 0 AND c.deleted = 0 AND e.date >= ? ${courseId ? 'AND e.course_id = ?' : ''}
     ORDER BY e.date`,
    todayISO(), ...(courseId ? [courseId] : []),
  );
}

export async function planTasks(examId: string): Promise<PlanTask[]> {
  const db = await getDb();
  return db.getAllAsync<PlanTask>('SELECT * FROM plan_tasks WHERE exam_id = ? ORDER BY date, done, rowid', examId);
}

export async function todaysTasks(): Promise<(PlanTask & { code: string; course_id: string })[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT t.*, c.code, e.course_id FROM plan_tasks t JOIN exams e ON e.id = t.exam_id JOIN courses c ON c.id = e.course_id
     WHERE t.date = ? AND e.deleted = 0 ORDER BY e.date, t.done`,
    todayISO(),
  );
}

export async function setTaskDone(taskId: string, done: boolean) {
  const db = await getDb();
  await db.runAsync('UPDATE plan_tasks SET done = ?, done_at = ? WHERE id = ?', done ? 1 : 0, done ? now() : null, taskId);
}

export const daysUntil = (date: string) => {
  const a = new Date(`${todayISO()}T00:00:00`);
  const b = new Date(`${date}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
};

// ---------------- plan generation ----------------

/** Rebuilds the plan from today (offline). See lib/plan.ts for how tasks are laid out. */
export async function rebuildPlan(examId: string) {
  const db = await getDb();
  const exam = await getExam(examId);
  if (!exam) return;
  const today = todayISO();

  const stats = await db.getAllAsync<LectureStat>(
    `SELECT l.id, l.kind, l.date, l.title,
       (SELECT COUNT(*) FROM cards c WHERE c.lecture_id = l.id) cards,
       (SELECT COUNT(*) FROM cards c WHERE c.lecture_id = l.id AND c.reps = 0) unseen,
       (SELECT COUNT(*) FROM cards c WHERE c.lecture_id = l.id AND (c.lapses > 0 OR (c.reps > 0 AND c.stability < 2))) weak,
       (SELECT COUNT(*) FROM questions q WHERE q.lecture_id = l.id) questions,
       COALESCE((SELECT json_array_length(a.emphasised) FROM lecture_ai a WHERE a.lecture_id = l.id), 0) emphasised
     FROM lectures l WHERE l.course_id = ? AND l.deleted = 0 AND l.date <= ? ORDER BY l.date`,
    exam.course_id, exam.date,
  );

  const drafts = buildPlan(stats, today, exam.date);

  await db.withTransactionAsync(async () => {
    // Keep finished work; drop everything else and lay the plan out again.
    // Lecture-bound tasks count once ever; weak/mock sessions count once per day.
    const doneRows = await db.getAllAsync<{ kind: string; ref_id: string | null; date: string }>(
      'SELECT kind, ref_id, date FROM plan_tasks WHERE exam_id = ? AND done = 1', examId,
    );
    const doneKey = new Set(doneRows.map((r) => taskKey(r.kind, r.ref_id, r.date)));
    await db.runAsync('DELETE FROM plan_tasks WHERE exam_id = ? AND done = 0', examId);
    for (const d of drafts) {
      if (doneKey.has(taskKey(d.kind, d.ref_id, d.date))) continue; // already done
      await db.runAsync(
        'INSERT INTO plan_tasks (id, exam_id, date, kind, ref_id, title) VALUES (?, ?, ?, ?, ?, ?)',
        newId(), examId, d.date, d.kind, d.ref_id, d.title,
      );
    }
  });
}

/** Called on app start / focus: keeps every plan current with new lectures and missed days. */
export async function refreshAllPlans() {
  for (const e of await upcomingExams()) await rebuildPlan(e.id);
}
