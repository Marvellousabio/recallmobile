import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Empty, Screen, T } from '@/components/ui';
import { Space, useColors } from '@/constants/theme';
import { CourseProgress, courseProgress, overview, Overview } from '@/db/progress';

export default function Progress() {
  const { t } = useTranslation();
  const c = useColors();
  const [ov, setOv] = useState<Overview | null>(null);
  const [courses, setCourses] = useState<CourseProgress[]>([]);
  const short = t('daysShort', { returnObjects: true }) as string[];

  useFocusEffect(
    useCallback(() => {
      overview().then(setOv);
      courseProgress().then(setCourses);
    }, []),
  );

  if (!ov) return null;
  const max = Math.max(1, ...ov.last7.map((d) => d.n));
  const withCards = courses.filter((co) => co.total > 0);

  return (
    <Screen>
      <T v="title">{t('progress.title')}</T>

      <View style={styles.stats}>
        <Card style={styles.stat}>
          <T v="title" style={{ color: c.accent }}>{ov.streak}</T>
          <T v="small">{t('progress.streak')}</T>
        </Card>
        <Card style={styles.stat}>
          <T v="title">{ov.retention == null ? '—' : `${ov.retention}%`}</T>
          <T v="small">{t('progress.retention')}</T>
        </Card>
        <Card style={styles.stat}>
          <T v="title">{ov.quizAccuracy == null ? '—' : `${ov.quizAccuracy}%`}</T>
          <T v="small">{t('progress.quiz')}</T>
        </Card>
      </View>

      <Card style={{ gap: Space.sm }}>
        <T v="heading">{t('progress.thisWeek', { count: ov.reviewsWeek })}</T>
        <View style={styles.chart} accessibilityLabel={t('progress.thisWeek', { count: ov.reviewsWeek })}>
          {ov.last7.map((d) => (
            <View key={d.date} style={styles.barCol}>
              <T v="small" style={{ fontSize: 11 }}>{d.n || ''}</T>
              <View style={[styles.barTrack, { backgroundColor: c.chip }]}>
                <View style={{ height: `${(d.n / max) * 100}%`, backgroundColor: c.primary, borderRadius: 4 }} />
              </View>
              <T v="small" style={{ fontSize: 11 }}>{short[new Date(`${d.date}T12:00:00`).getDay()]}</T>
            </View>
          ))}
        </View>
      </Card>

      <T v="heading">{t('progress.byCourse')}</T>
      {withCards.length === 0 && <Empty text={t('progress.empty')} />}
      {withCards.map((co) => {
        const pct = Math.round((co.strong / co.total) * 100);
        return (
          <Card key={co.course_id} onPress={() => router.push(`/course/${co.course_id}`)} style={{ gap: Space.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.sm }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: co.color }} />
              <T v="heading" style={{ flex: 1 }}>{co.code}</T>
              <T v="body" style={{ fontWeight: '700' }}>{pct}%</T>
            </View>
            <View style={[styles.track, { backgroundColor: c.chip }]}>
              <View style={{ width: `${pct}%`, height: 8, backgroundColor: c.primary, borderRadius: 4 }} />
            </View>
            <T v="small">{t('progress.strongOf', { strong: co.strong, total: co.total })}</T>
            {co.weakTopics.length > 0 && (
              <>
                <T v="small" style={{ color: c.danger, fontWeight: '600' }}>{t('progress.weakTopics')}</T>
                {co.weakTopics.map((w) => <T key={w.topic} v="small">• {w.topic} ({w.n})</T>)}
                <Button
                  kind="ghost"
                  label={t('plan.weak')}
                  onPress={() => router.push({ pathname: '/review', params: { courseId: co.course_id, mode: 'weak' } })}
                />
              </>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: Space.sm },
  stat: { flex: 1, alignItems: 'center', paddingVertical: Space.md },
  chart: { flexDirection: 'row', height: 120, gap: Space.xs, alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center', gap: 2, height: '100%' },
  barTrack: { flex: 1, width: '70%', borderRadius: 4, justifyContent: 'flex-end', overflow: 'hidden' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
});
