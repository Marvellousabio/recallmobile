import * as Network from 'expo-network';

import { getDb, newId, now } from '@/db';
import { isQuotaError } from '@/lib/billing';
import { supabase } from '@/lib/supabase';

export type TutorMessage = {
  id: string;
  course_id: string;
  role: 'user' | 'assistant';
  content: string;
  state: 'sent' | 'pending' | 'failed';
  created_at: string;
};

export async function listMessages(courseId: string): Promise<TutorMessage[]> {
  const db = await getDb();
  return db.getAllAsync<TutorMessage>('SELECT * FROM tutor_messages WHERE course_id = ? ORDER BY created_at', courseId);
}

/** Saves the question locally first, so nothing is lost offline. */
export async function ask(courseId: string, text: string) {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO tutor_messages (id, course_id, role, content, state, created_at) VALUES (?, ?, 'user', ?, 'pending', ?)",
    newId(), courseId, text, now(),
  );
  return flushPending(courseId);
}

let busy = false;

export type FlushResult = 'offline' | 'signed-out' | 'ok' | 'error' | 'quota';

/** Sends unanswered questions for a course. */
export async function flushPending(courseId: string): Promise<FlushResult> {
  if (!supabase) return 'signed-out';
  const { data } = await supabase.auth.getSession();
  if (!data.session) return 'signed-out';
  const net = await Network.getNetworkStateAsync();
  if (!net.isConnected || net.isInternetReachable === false) return 'offline';
  if (busy) return 'ok';
  busy = true;
  const db = await getDb();
  try {
    // Answer pending questions one at a time, oldest first, each with the history before it.
    for (;;) {
      const all = await listMessages(courseId);
      const idx = all.findIndex((m) => m.role === 'user' && m.state !== 'sent');
      if (idx < 0) return 'ok';
      const history = all.slice(0, idx + 1).filter((m) => m.state === 'sent' || m === all[idx]);
      const { data: res, error } = await supabase.functions.invoke('tutor', {
        body: { course_id: courseId, message_id: all[idx].id, messages: history.map((m) => ({ role: m.role, content: m.content })) },
      });
      if (isQuotaError(error)) {
        await db.runAsync("UPDATE tutor_messages SET state = 'failed' WHERE id = ?", all[idx].id);
        return 'quota';
      }
      if (error || !res?.reply) {
        await db.runAsync("UPDATE tutor_messages SET state = 'failed' WHERE id = ?", all[idx].id);
        return 'error';
      }
      await db.withTransactionAsync(async () => {
        await db.runAsync("UPDATE tutor_messages SET state = 'sent' WHERE id = ?", all[idx].id);
        await db.runAsync(
          "INSERT INTO tutor_messages (id, course_id, role, content, state, created_at) VALUES (?, ?, 'assistant', ?, 'sent', ?)",
          newId(), courseId, res.reply, now(),
        );
      });
    }
  } finally {
    busy = false;
  }
}

export async function retry(messageId: string, courseId: string) {
  const db = await getDb();
  await db.runAsync("UPDATE tutor_messages SET state = 'pending' WHERE id = ?", messageId);
  return flushPending(courseId);
}
