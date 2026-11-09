/**
 * Study-plan generator — pure, no I/O, so it can be unit-tested.
 *
 *   - every lecture gets a "learn" task (recall its cards) then, 2+ days later, a "quiz"
 *   - lectures with more lecturer-emphasised points and weaker memory go first
 *   - past papers are practised mid-way and again near the end
 *   - "fix weak spots" sessions every 3rd day; the day before the exam is weak + mock
 */

export type PlanKind = 'learn' | 'quiz' | 'past' | 'weak' | 'mock';

export type LectureStat = {
  id: string;
  kind: 'lecture' | 'past_paper';
  date: string;
  title: string | null;
  cards: number;
  unseen: number;
  weak: number;
  questions: number;
  emphasised: number;
};

export type Draft = { date: string; kind: PlanKind; ref_id: string | null; title: string };

export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

export const dayDiff = (from: string, to: string) => {
  const [a, b] = [from, to].map((s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86400000);
};

const priority = (s: LectureStat) => s.emphasised * 2 + s.weak + s.unseen * 0.5;

export function buildPlan(stats: LectureStat[], today: string, examDate: string): Draft[] {
  const days = Math.max(0, dayDiff(today, examDate)); // study days before exam day
  const lectures = stats
    .filter((s) => s.kind !== 'past_paper' && (s.cards > 0 || s.questions > 0))
    .sort((a, b) => priority(b) - priority(a) || a.date.localeCompare(b.date));
  const papers = stats.filter((s) => s.kind === 'past_paper' && s.questions > 0);
  const label = (s: LectureStat) => s.title || s.date;
  const out: Draft[] = [];

  if (days === 0) {
    // Exam is today: a quick weak-spot pass and a warm-up mock only.
    out.push({ date: today, kind: 'weak', ref_id: null, title: 'weak' });
    out.push({ date: today, kind: 'mock', ref_id: null, title: 'mock' });
    return out;
  }

  const studyDays = Array.from({ length: days }, (_, i) => addDays(today, i));
  const lastDay = studyDays[studyDays.length - 1];
  const learnDays = studyDays.length > 1 ? studyDays.slice(0, -1) : studyDays;

  lectures.forEach((l, i) => {
    const di = Math.floor((i * learnDays.length) / lectures.length);
    out.push({ date: learnDays[di], kind: 'learn', ref_id: l.id, title: label(l) });
    if (l.questions > 0) {
      const qi = Math.min(learnDays.length - 1, di + 2);
      out.push({ date: learnDays[qi], kind: 'quiz', ref_id: l.id, title: label(l) });
    }
  });

  const mid = Math.floor(learnDays.length / 2);
  papers.forEach((p, i) => {
    out.push({ date: learnDays[Math.min(learnDays.length - 1, mid + i)], kind: 'past', ref_id: p.id, title: label(p) });
  });

  for (let i = 2; i < learnDays.length; i += 3) out.push({ date: learnDays[i], kind: 'weak', ref_id: null, title: 'weak' });
  out.push({ date: lastDay, kind: 'weak', ref_id: null, title: 'weak' });
  out.push({ date: lastDay, kind: 'mock', ref_id: null, title: 'mock' });
  return out;
}

/** Identity used to keep finished tasks across rebuilds. */
export const taskKey = (kind: string, ref: string | null, date: string) => (ref ? `${kind}:${ref}` : `${kind}@${date}`);
