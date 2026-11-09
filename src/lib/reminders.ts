import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { getDb } from '@/db';
import i18n from '@/i18n';

/**
 * All reminders are LOCAL notifications: scheduled on the phone, delivered
 * with no internet. Push/email come later for re-engagement.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const DAILY_ID = 'daily-recall';
const DAILY_HOUR = 19; // 7 PM — after lectures, before night reading

export async function initReminders(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('recall', {
      name: 'Recall reminders',
      importance: 4, // AndroidImportance.HIGH (enum re-export trips eslint import/namespace)
    });
  }
  const cur = await Notifications.getPermissionsAsync();
  const granted = cur.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (granted) await scheduleDaily();
  return granted;
}

/** Re-run after a language change so the text matches. */
export async function scheduleDaily() {
  await Notifications.cancelScheduledNotificationAsync(DAILY_ID).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: DAILY_ID,
    content: { title: i18n.t('reminders.dailyTitle'), body: i18n.t('reminders.dailyBody'), data: { url: '/review' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: DAILY_HOUR, minute: 0, channelId: 'recall' },
  });
}

/**
 * Morning countdown (8 AM) every day until a test: "5 days to EEG 413 — 3 tasks today".
 * Scheduled as one-off notifications so they stop on their own after the exam.
 */
export async function scheduleExamCountdown(exam: { id: string; date: string; code: string }, deleted = false) {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    all.filter((n) => n.identifier.startsWith(`exam-${exam.id}-`)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
  if (deleted) return;
  const db = await getDb();
  const examDay = new Date(`${exam.date}T00:00:00`);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let d = new Date(start), i = 0; d <= examDay && i < 60; d.setDate(d.getDate() + 1), i++) {
    const at = new Date(d);
    at.setHours(8, 0, 0, 0);
    if (at.getTime() <= Date.now()) continue;
    const left = Math.round((examDay.getTime() - d.getTime()) / 86400000);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const tasks = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM plan_tasks WHERE exam_id = ? AND date = ?', exam.id, iso))?.n ?? 0;
    await Notifications.scheduleNotificationAsync({
      identifier: `exam-${exam.id}-${iso}`,
      content: {
        title: left === 0 ? i18n.t('reminders.examToday', { code: exam.code }) : i18n.t('reminders.examIn', { code: exam.code, count: left }),
        body: left === 0 ? i18n.t('reminders.examTodayBody') : i18n.t('reminders.examTasks', { count: tasks }),
        data: { url: `/exam/${exam.id}` },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'recall' },
    });
  }
}

/**
 * Quick recall 30 minutes after a class ends: "close your notes and write
 * what you remember". Scheduled when the lecture is opened for capture.
 */
export async function scheduleQuickRecall(lectureId: string, courseCode: string) {
  const db = await getDb();
  const r = await db.getFirstAsync<{ date: string; end_min: number | null; recall_dump: string | null }>(
    'SELECT l.date, s.end_min, l.recall_dump FROM lectures l LEFT JOIN timetable_slots s ON s.id = l.slot_id WHERE l.id = ?',
    lectureId,
  );
  if (!r || r.end_min == null || r.recall_dump) return;
  const at = new Date(`${r.date}T00:00:00`);
  at.setMinutes(r.end_min + 30);
  if (at.getTime() <= Date.now()) return;
  const id = `quick-${lectureId}`;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title: i18n.t('reminders.quickTitle', { code: courseCode }),
      body: i18n.t('reminders.quickBody'),
      data: { url: `/lecture/${lectureId}?recall=1` },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'recall' },
  });
}
