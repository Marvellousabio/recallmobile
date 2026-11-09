import { getDb } from './index';
import { todayISO } from './lectures';

export type CourseProgress = {
  course_id: string;
  code: string;
  color: string;
  total: number;
  strong: number;
  weak: number;
  weakTopics: { topic: string; n: number }[];
};

export type Overview = {
  streak: number;
  reviewsWeek: number;
  retention: number | null; // % of reviews last 30 days not "Forgot"
  last7: { date: string; n: number }[];
  quizAccuracy: number | null;
};

/** Local calendar date of an ISO timestamp, as YYYY-MM-DD. */
const localDay = (iso: string) => todayISO(new Date(iso));

export async function overview(): Promise<Overview> {
  const db = await getDb();
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const logs = await db.getAllAsync<{ reviewed_at: string; rating: number }>(
    'SELECT reviewed_at, rating FROM review_logs WHERE reviewed_at >= ?', since,
  );
  const perDay = new Map<string, number>();
  for (const l of logs) {
    const d = localDay(l.reviewed_at);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }

  // Streak: consecutive days with ≥1 review, ending today (or yesterday if not yet today).
  let streak = 0;
  const cursor = new Date();
  if (!perDay.has(todayISO(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (perDay.has(todayISO(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const iso = todayISO(d);
    return { date: iso, n: perDay.get(iso) ?? 0 };
  });

  const cutoff30 = Date.now() - 30 * 86400000;
  const recent = logs.filter((l) => new Date(l.reviewed_at).getTime() >= cutoff30);
  const retention = recent.length ? Math.round((recent.filter((l) => l.rating > 1).length / recent.length) * 100) : null;

  const q = await db.getFirstAsync<{ n: number; ok: number }>(
    'SELECT COUNT(*) n, COALESCE(SUM(correct), 0) ok FROM quiz_attempts WHERE at >= ?',
    new Date(cutoff30).toISOString(),
  );

  return {
    streak,
    reviewsWeek: last7.reduce((s, d) => s + d.n, 0),
    retention,
    last7,
    quizAccuracy: q && q.n ? Math.round((q.ok / q.n) * 100) : null,
  };
}

export async function courseProgress(): Promise<CourseProgress[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Omit<CourseProgress, 'weakTopics'>>(
    `SELECT co.id course_id, co.code, co.color,
       COUNT(c.id) total,
       COALESCE(SUM(CASE WHEN c.reps > 0 AND c.stability >= 7 THEN 1 ELSE 0 END), 0) strong,
       COALESCE(SUM(CASE WHEN c.lapses > 0 OR (c.reps > 0 AND c.stability < 2) THEN 1 ELSE 0 END), 0) weak
     FROM courses co LEFT JOIN cards c ON c.course_id = co.id
     WHERE co.deleted = 0 GROUP BY co.id ORDER BY co.code`,
  );
  const out: CourseProgress[] = [];
  for (const r of rows) {
    const weakTopics = await db.getAllAsync<{ topic: string; n: number }>(
      `SELECT COALESCE(topic, '—') topic, COUNT(*) n FROM cards
       WHERE course_id = ? AND (lapses > 0 OR (reps > 0 AND stability < 2))
       GROUP BY topic ORDER BY n DESC LIMIT 3`,
      r.course_id,
    );
    out.push({ ...r, weakTopics });
  }
  return out;
}
