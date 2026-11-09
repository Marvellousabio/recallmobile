import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SlotRow } from '@/components/slot-row';
import { Button, Card, Empty, Screen, T } from '@/components/ui';
import { Space, useColors } from '@/constants/theme';
import { daysUntil, ExamWithCourse, refreshAllPlans, todaysTasks, upcomingExams } from '@/db/exams';
import { openTask, useTaskLabel } from '@/lib/plan-ui';
import { openLecture } from '@/db/lectures';
import { listSlots, SlotWithCourse } from '@/db/repo';
import { DueByCourse, dueByCourse } from '@/db/study';
import { useApp } from '@/state/app';
import { useSync } from '@/state/sync';

export default function Today() {
  const { t } = useTranslation();
  const { profile } = useApp();
  const { aiTick } = useSync();
  const [slots, setSlots] = useState<SlotWithCourse[]>([]);
  const [due, setDue] = useState<DueByCourse[]>([]);
  const [exams, setExams] = useState<ExamWithCourse[]>([]);
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof todaysTasks>>>([]);
  const c = useColors();
  const label = useTaskLabel();
  const today = new Date().getDay();
  const days = t('days', { returnObjects: true }) as string[];
  const totalDue = due.reduce((n, d) => n + d.due, 0);

  useFocusEffect(
    useCallback(() => {
      listSlots().then((all) => setSlots(all.filter((s) => s.weekday === today)));
      dueByCourse().then(setDue);
      (async () => {
        await refreshAllPlans(); // new lectures, missed days → plans stay current
        setExams(await upcomingExams());
        setTasks(await todaysTasks());
      })();
    }, [today, aiTick]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <Screen>
      <T v="small">{days[today]}</T>
      <T v="title">{t('today.greeting', { name: profile?.name?.split(' ')[0] ?? '' })}</T>

      <T v="heading">{t('today.recallDue')}</T>
      {totalDue === 0 ? (
        <Empty text={t('today.recallEmpty')} />
      ) : (
        <Card style={{ gap: Space.sm }}>
          <T v="title">{t('recall.cardsDue', { count: totalDue })}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
            {due.map((d) => (
              <Card key={d.course_id} onPress={() => router.push({ pathname: '/review', params: { courseId: d.course_id } })} style={{ flexDirection: 'row', gap: Space.sm, alignItems: 'center', paddingVertical: Space.sm }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: d.color }} />
                <T v="body">{d.code}</T>
                <T v="small">{d.due}</T>
              </Card>
            ))}
          </View>
          <Button label={t('recall.start')} onPress={() => router.push('/review')} />
        </Card>
      )}

      {exams.length > 0 && (
        <>
          <T v="heading">{t('plan.todaysPlan')}</T>
          {exams.map((e) => {
            const mine = tasks.filter((tk) => tk.exam_id === e.id);
            const left = daysUntil(e.date);
            return (
              <Card key={e.id} style={{ gap: Space.sm }}>
                <Pressable onPress={() => router.push(`/exam/${e.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: Space.sm }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: e.color }} />
                  <T v="body" style={{ fontWeight: '700', flex: 1 }}>{e.code} · {e.title || (e.kind === 'exam' ? t('exam.exam') : t('exam.test'))}</T>
                  <T v="small" style={{ color: c.accent, fontWeight: '700' }}>{left === 0 ? t('plan.today') : t('exam.inDays', { count: left })}</T>
                </Pressable>
                {mine.length === 0 && <T v="small">{t('plan.restDay')}</T>}
                {mine.map((tk) => (
                  <Pressable key={tk.id} onPress={() => openTask(tk, tk.course_id)} style={{ flexDirection: 'row', gap: Space.sm, alignItems: 'center' }}>
                    <T style={{ color: tk.done ? c.primary : c.muted }}>{tk.done ? '✓' : '○'}</T>
                    <T v="body" style={{ flex: 1, color: tk.done ? c.muted : c.text, textDecorationLine: tk.done ? 'line-through' : 'none' }}>{label(tk)}</T>
                  </Pressable>
                ))}
              </Card>
            );
          })}
        </>
      )}

      <T v="heading">{t('today.classesToday')}</T>
      {slots.length === 0 ? (
        <Empty text={t('today.noClasses')} />
      ) : (
        slots.map((s) => (
          <SlotRow
            key={s.id}
            s={s}
            onPress={async () => router.push(`/lecture/${await openLecture(s.course_id, s.id)}`)}
          />
        ))
      )}
    </Screen>
  );
}
