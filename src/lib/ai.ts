import { getDb } from '@/db';
import { saveStudyPack } from '@/db/study';
import { cachedPlan, isPremium, isQuotaError } from '@/lib/billing';
import { supabase } from '@/lib/supabase';

const MAX_ATTEMPTS = 5;

/**
 * Runs queued AI jobs once their lecture's files are in the cloud.
 * Called after every successful sync, so it only ever runs online.
 */
export async function processAiQueue(): Promise<number> {
  if (!supabase) return 0;
  const db = await getDb();
  // A job left 'running' means the app was killed mid-request — retry it.
  await db.runAsync("UPDATE ai_jobs SET state = 'queued' WHERE state = 'running'");
  // Lectures held back by the free limit retry in a new month, or once the student is Premium.
  const month = new Date().toISOString().slice(0, 7);
  const premium = isPremium(await cachedPlan());
  await db.runAsync(
    "UPDATE ai_jobs SET state = 'queued' WHERE state = 'quota' AND (? OR error != ?)",
    premium ? 1 : 0, `quota:${month}`,
  );
  await db.runAsync(
    "UPDATE lectures SET status = 'queued' WHERE status = 'quota' AND id IN (SELECT ref_id FROM ai_jobs WHERE state = 'queued')",
  );
  const jobs = await db.getAllAsync<{ id: string; ref_id: string; attempts: number }>(
    "SELECT id, ref_id, attempts FROM ai_jobs WHERE kind = 'process_lecture' AND state = 'queued' AND attempts < ? ORDER BY created_at",
    MAX_ATTEMPTS,
  );
  let done = 0;
  for (const job of jobs) {
    // Wait until the lecture row and every file have been pushed.
    const notReady = await db.getFirstAsync(
      `SELECT 1 FROM assets WHERE lecture_id = ? AND upload_state != 'uploaded'
       UNION ALL SELECT 1 FROM sync_outbox WHERE row_id = ? LIMIT 1`,
      job.ref_id, job.ref_id,
    );
    if (notReady) continue;

    await db.runAsync("UPDATE ai_jobs SET state = 'running', attempts = attempts + 1 WHERE id = ?", job.id);
    await db.runAsync("UPDATE lectures SET status = 'processing' WHERE id = ?", job.ref_id);
    try {
      const { data, error } = await supabase.functions.invoke('process-lecture', { body: { lecture_id: job.ref_id } });
      if (isQuotaError(error)) {
        // Not a failure: keep the job, don't burn an attempt, and stop — every other lecture would hit the same limit.
        await db.runAsync("UPDATE ai_jobs SET state = 'quota', error = ?, attempts = attempts - 1 WHERE id = ?", `quota:${month}`, job.id);
        await db.runAsync("UPDATE lectures SET status = 'quota' WHERE id = ?", job.ref_id);
        break;
      }
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await fetchStudyPack(job.ref_id);
      await db.runAsync("UPDATE ai_jobs SET state = 'done', error = NULL WHERE id = ?", job.id);
      done++;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      const giveUp = job.attempts + 1 >= MAX_ATTEMPTS || msg.includes('nothing to process');
      await db.runAsync('UPDATE ai_jobs SET state = ?, error = ? WHERE id = ?', giveUp ? 'failed' : 'queued', msg, job.id);
      await db.runAsync('UPDATE lectures SET status = ? WHERE id = ?', giveUp ? 'failed' : 'queued', job.ref_id);
    }
  }
  return done;
}

/** Downloads the study pack for one lecture into the local database. */
export async function fetchStudyPack(lectureId: string) {
  const sb = supabase!;
  const [pack, cards, questions] = await Promise.all([
    sb.from('lecture_ai').select('*').eq('lecture_id', lectureId).single(),
    sb.from('cards').select('id, course_id, topic, front, back').eq('lecture_id', lectureId),
    sb.from('questions').select('id, course_id, topic, question, options, answer_index, explanation, source').eq('lecture_id', lectureId),
  ]);
  if (pack.error) throw pack.error;
  await saveStudyPack(
    {
      lecture_id: lectureId,
      summary: pack.data.summary,
      key_points: pack.data.key_points,
      emphasised: pack.data.emphasised,
      topics: pack.data.topics,
    },
    cards.data ?? [],
    questions.data ?? [],
  );
}
