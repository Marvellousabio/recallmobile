import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { SlotRow } from '@/components/slot-row';
import { Button, Card, Empty, Screen, T } from '@/components/ui';
import { Space, useColors } from '@/constants/theme';
import { daysUntil, ExamWithCourse, upcomingExams } from '@/db/exams';
import { addPastPaper, formatDuration, LectureSummary, listLectures, openLecture } from '@/db/lectures';
import { Course, deleteCourse, deleteSlot, getCourse, listSlots, SlotWithCourse } from '@/db/repo';

export default function CourseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const [course, setCourse] = useState<Course | null>(null);
  const [slots, setSlots] = useState<SlotWithCourse[]>([]);
  const [lectures, setLectures] = useState<LectureSummary[]>([]);
  const [exams, setExams] = useState<ExamWithCourse[]>([]);
  const days = t('days', { returnObjects: true }) as string[];

  const load = useCallback(() => {
    getCourse(id).then(setCourse);
    listSlots(id).then(setSlots);
    listLectures(id).then(setLectures);
    upcomingExams(id).then(setExams);
  }, [id]);
  useFocusEffect(load);

  const capture = async () => {
    const todaySlot = slots.find((s) => s.weekday === new Date().getDay());
    const lectureId = await openLecture(id, todaySlot?.id ?? null);
    router.push(`/lecture/${lectureId}`);
  };

  const addPast = async () => {
    const lectureId = await addPastPaper(id, null);
    router.push(`/lecture/${lectureId}`);
  };

  if (!course) return null;

  const classes = lectures.filter((l) => l.kind !== 'past_paper');
  const papers = lectures.filter((l) => l.kind === 'past_paper');
  const hasQuestions = lectures.some((l) => l.status === 'ready');

  const confirmDelete = () =>
    Alert.alert(course.code, t('courses.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: async () => { await deleteCourse(course.id); router.back(); } },
    ]);

  const confirmSlotDelete = (s: SlotWithCourse) =>
    Alert.alert(days[s.weekday], undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: async () => { await deleteSlot(s.id); load(); } },
    ]);

  const dateShort = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <Screen>
      <Stack.Screen options={{ title: course.code }} />
      <T v="title">{course.title}</T>
      {course.lecturer && <T v="muted">{course.lecturer}</T>}
      <Button label={t('lecture.capture')} onPress={capture} />
      <View style={{ flexDirection: 'row', gap: Space.sm }}>
        <Button kind="ghost" label={t('tutor.open')} onPress={() => router.push(`/tutor/${course.id}`)} style={{ flex: 1, paddingHorizontal: Space.sm }} />
        <Button
          kind="ghost"
          label={t('quiz.practice')}
          disabled={!hasQuestions}
          onPress={() => router.push({ pathname: '/quiz', params: { courseId: course.id } })}
          style={{ flex: 1, paddingHorizontal: Space.sm }}
        />
      </View>

      {/* Tests & exams */}
      <T v="heading">{t('exam.section')}</T>
      {exams.map((e) => {
        const left = daysUntil(e.date);
        return (
          <Card key={e.id} onPress={() => router.push(`/exam/${e.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md }}>
            <T v="title" style={{ color: c.accent, minWidth: 44, textAlign: 'center' }}>{left}</T>
            <View style={{ flex: 1 }}>
              <T v="body" style={{ fontWeight: '600' }}>{e.title || (e.kind === 'exam' ? t('exam.exam') : t('exam.test'))}</T>
              <T v="small">{dateShort(e.date)} · {left === 1 ? t('exam.dayLeft') : t('exam.daysLeft')}</T>
            </View>
          </Card>
        );
      })}
      <Button kind="ghost" label={t('exam.add')} onPress={() => router.push({ pathname: '/exam/new', params: { courseId: course.id } })} />

      {/* Lectures */}
      <T v="heading">{t('lecture.lectures')}</T>
      {classes.length === 0 && <Empty text={t('lecture.noLectures')} />}
      {classes.map((l) => (
        <Card key={l.id} onPress={() => router.push(`/lecture/${l.id}`)}>
          <T v="body" style={{ fontWeight: '600' }}>{l.title || dateShort(l.date)}</T>
          <T v="small">
            {[
              l.title ? l.date : null,
              l.audio_count ? `🎙 ${formatDuration(l.audio_ms)}` : null,
              l.slide_count ? `▤ ${l.slide_count}` : null,
              l.status === 'ready' ? `✓ ${t('ai.ready')}` : l.status === 'queued' || l.status === 'processing' ? t('ai.waiting') : null,
            ]
              .filter(Boolean)
              .join('  ·  ')}
          </T>
        </Card>
      ))}

      {/* Past questions */}
      <T v="heading">{t('past.section')}</T>
      {papers.length === 0 && <Empty text={t('past.empty')} />}
      {papers.map((p) => (
        <Card key={p.id} onPress={() => router.push(`/lecture/${p.id}`)}>
          <T v="body" style={{ fontWeight: '600' }}>{p.title || t('past.untitled')}</T>
          <T v="small">{p.status === 'ready' ? `✓ ${t('ai.ready')}` : p.slide_count ? t('ai.waiting') : t('past.addFiles')}</T>
        </Card>
      ))}
      <Button kind="ghost" label={t('past.add')} onPress={addPast} />

      {/* Timetable */}
      <T v="heading">{t('courses.classes')}</T>
      {slots.length === 0 && <Empty text={t('courses.noClasses')} />}
      {slots.map((s) => (
        <SlotRow key={s.id} s={{ ...s, code: days[s.weekday] }} onPress={() => confirmSlotDelete(s)} />
      ))}
      <Button kind="ghost" label={t('courses.addClass')} onPress={() => router.push({ pathname: '/slot/new', params: { courseId: course.id } })} />
      <Button label={t('common.delete')} kind="danger" onPress={confirmDelete} style={{ marginTop: Space.lg }} />
    </Screen>
  );
}
