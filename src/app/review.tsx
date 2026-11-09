import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Grade } from 'ts-fsrs';

import { Button, Card, Screen, T } from '@/components/ui';
import { Radius, Space, useColors } from '@/constants/theme';
import { setTaskDone } from '@/db/exams';
import { dueCards, formatInterval, previewIntervals, Rating, reviewCard, StudyCard, weakCards } from '@/db/study';

export default function Review() {
  const { courseId, lectureId, mode, taskId } = useLocalSearchParams<{
    courseId?: string;
    lectureId?: string;
    mode?: 'weak';
    taskId?: string;
  }>();
  const { t } = useTranslation();
  const c = useColors();
  const [queue, setQueue] = useState<StudyCard[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  useEffect(() => {
    (mode === 'weak' && courseId ? weakCards(courseId) : dueCards({ courseId, lectureId })).then(setQueue);
  }, [courseId, lectureId, mode]);

  const card = queue?.[0];
  const previews = useMemo(() => (card ? previewIntervals(card) : null), [card]);

  // Finishing a session completes the study-plan task that opened it.
  useEffect(() => {
    if (taskId && queue && queue.length === 0 && doneCount > 0) setTaskDone(taskId, true);
  }, [taskId, queue, doneCount]);

  const rate = async (r: Grade) => {
    if (!card) return;
    const updated = await reviewCard(card, r);
    setRevealed(false);
    setDoneCount((n) => n + 1);
    setQueue((q) => {
      const rest = (q ?? []).slice(1);
      // Cards due again within this session (e.g. "Forgot" → 1 min) go to the back.
      return new Date(updated.due).getTime() - Date.now() < 10 * 60 * 1000 ? [...rest, updated] : rest;
    });
  };

  if (!queue) return null;

  if (!card) {
    return (
      <Screen>
        <T v="title">{doneCount ? t('recall.doneTitle') : t('recall.nothingDue')}</T>
        <T v="muted">{doneCount ? t('recall.doneBody', { count: doneCount }) : t('recall.nothingDueBody')}</T>
        <Button label={t('common.back')} onPress={() => router.back()} />
      </Screen>
    );
  }

  const buttons: { r: Grade; label: string; color: string }[] = [
    { r: Rating.Again, label: t('recall.again'), color: c.danger },
    { r: Rating.Hard, label: t('recall.hard'), color: c.accent },
    { r: Rating.Good, label: t('recall.good'), color: c.primary },
    { r: Rating.Easy, label: t('recall.easy'), color: c.primary },
  ];

  return (
    <Screen>
      <T v="small">{t('recall.left', { count: queue.length })}</T>
      <Pressable onPress={() => setRevealed(true)} accessibilityRole="button" accessibilityHint={t('recall.tapToReveal')}>
        <Card style={styles.card}>
          {card.topic && <T v="small" style={{ color: c.accent }}>{card.topic}</T>}
          <T v="heading" style={styles.front}>{card.front}</T>
          {revealed ? (
            <>
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <T v="body">{card.back}</T>
            </>
          ) : (
            <T v="small" style={{ textAlign: 'center', marginTop: Space.lg }}>{t('recall.thinkFirst')}</T>
          )}
        </Card>
      </Pressable>

      {!revealed ? (
        <Button label={t('recall.show')} onPress={() => setRevealed(true)} />
      ) : (
        <>
          <T v="small" style={{ textAlign: 'center' }}>{t('recall.howWell')}</T>
          <View style={styles.row}>
            {buttons.map((b) => (
              <Pressable
                key={b.r}
                onPress={() => rate(b.r)}
                style={({ pressed }) => [styles.rateBtn, { borderColor: b.color, opacity: pressed ? 0.7 : 1 }]}>
                <T v="body" style={{ color: b.color, fontWeight: '700' }}>{b.label}</T>
                <T v="small">{previews && formatInterval(previews[b.r])}</T>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 260, padding: Space.lg, gap: Space.sm },
  front: { fontSize: 21, lineHeight: 29 },
  divider: { height: 1, marginVertical: Space.sm },
  row: { flexDirection: 'row', gap: Space.sm },
  rateBtn: { flex: 1, borderWidth: 1.5, borderRadius: Radius.md, paddingVertical: Space.sm, alignItems: 'center', gap: 2 },
});
