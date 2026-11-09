import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Empty, Screen, T } from '@/components/ui';
import { Radius, Space, useColors } from '@/constants/theme';
import { daysUntil, deleteExam, ExamWithCourse, getExam, PlanTask, planTasks, rebuildPlan, setTaskDone } from '@/db/exams';
import { todayISO } from '@/db/lectures';
import { courseMastery } from '@/db/study';
import { openTask, useTaskLabel } from '@/lib/plan-ui';
import { scheduleExamCountdown } from '@/lib/reminders';

export default function ExamDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const label = useTaskLabel();
  const [exam, setExam] = useState<ExamWithCourse | null>(null);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [mastery, setMastery] = useState({ total: 0, strong: 0, weak: 0 });

  const load = useCallback(() => {
    (async () => {
      await rebuildPlan(id); // picks up new lectures and missed days
      const e = await getExam(id);
      setExam(e);
      setTasks(await planTasks(id));
      if (e) setMastery(await courseMastery(e.course_id));
    })();
  }, [id]);
  useFocusEffect(load);

  if (!exam) return null;
  const left = daysUntil(exam.date);
  const today = todayISO();
  const readiness = mastery.total ? Math.round((mastery.strong / mastery.total) * 100) : 0;
  const byDay = tasks.reduce<Record<string, PlanTask[]>>((acc, tk) => ((acc[tk.date] ||= []).push(tk), acc), {});
  const upcoming = Object.keys(byDay).filter((d) => d >= today).sort();
  const doneCount = tasks.filter((tk) => tk.done).length;

  const toggle = async (tk: PlanTask) => {
    await setTaskDone(tk.id, !tk.done);
    setTasks(await planTasks(id));
  };

  const confirmDelete = () =>
    Alert.alert(t('exam.deleteConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteExam(exam.id);
          scheduleExamCountdown(exam, true).catch(() => {});
          router.back();
        },
      },
    ]);

  const dayLabel = (d: string) =>
    d === today ? t('plan.today') : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <Screen>
      <Stack.Screen options={{ title: `${exam.code} · ${exam.kind === 'exam' ? t('exam.exam') : t('exam.test')}` }} />
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Space.lg, padding: Space.lg }}>
        <View style={{ alignItems: 'center' }}>
          <T v="title" style={{ fontSize: 40, lineHeight: 44, color: c.accent }}>{left}</T>
          <T v="small">{left === 1 ? t('exam.dayLeft') : t('exam.daysLeft')}</T>
        </View>
        <View style={{ flex: 1, gap: Space.xs }}>
          <T v="heading">{exam.title || new Date(`${exam.date}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'full' })}</T>
          <T v="small">{t('exam.readiness', { pct: readiness })}</T>
          <View style={[styles.bar, { backgroundColor: c.chip }]}>
            <View style={[styles.fill, { width: `${readiness}%`, backgroundColor: c.primary }]} />
          </View>
          {mastery.weak > 0 && <T v="small" style={{ color: c.danger }}>{t('exam.weakCards', { count: mastery.weak })}</T>}
        </View>
      </Card>

      <T v="small">{t('exam.planProgress', { done: doneCount, total: tasks.length })}</T>
      {tasks.length === 0 && <Empty text={t('exam.emptyPlan')} />}

      {upcoming.map((d) => (
        <View key={d} style={{ gap: Space.sm }}>
          <T v="heading" style={{ marginTop: Space.sm, color: d === today ? c.primary : c.text }}>{dayLabel(d)}</T>
          {byDay[d].map((tk) => (
            <Card key={tk.id} style={styles.task} onPress={d === today || d < today ? () => openTask(tk, exam.course_id) : undefined}>
              <Pressable
                hitSlop={10}
                onPress={() => toggle(tk)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !!tk.done }}
                style={[styles.check, { borderColor: tk.done ? c.primary : c.border, backgroundColor: tk.done ? c.primary : 'transparent' }]}>
                {!!tk.done && <T style={{ color: c.primaryText, fontSize: 13 }}>✓</T>}
              </Pressable>
              <T v="body" style={{ flex: 1, textDecorationLine: tk.done ? 'line-through' : 'none', color: tk.done ? c.muted : c.text }}>
                {label(tk)}
              </T>
              {d === today && !tk.done && <T v="small" style={{ color: c.primary }}>{t('plan.start')} ›</T>}
            </Card>
          ))}
        </View>
      ))}

      <Button kind="danger" label={t('common.delete')} onPress={confirmDelete} style={{ marginTop: Space.lg }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  task: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  check: { width: 24, height: 24, borderRadius: Radius.sm, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});
