import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Screen, T } from '@/components/ui';
import { Radius, Space, useColors } from '@/constants/theme';
import { setTaskDone } from '@/db/exams';
import { Question, quizQuestions, recordAttempt } from '@/db/study';

/**
 * Practice quiz. Works offline.
 *  ?lectureId=…  one lecture's questions (or a past paper's)
 *  ?courseId=…   mixed mock across the course, weakest first
 *  ?taskId=…     marks the study-plan task done on finish
 */
export default function Quiz() {
  const { lectureId, courseId, taskId } = useLocalSearchParams<{ lectureId?: string; courseId?: string; taskId?: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const [qs, setQs] = useState<Question[] | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);

  useEffect(() => {
    quizQuestions({ lectureId, courseId, limit: courseId ? 25 : 40 }).then(setQs);
  }, [lectureId, courseId]);

  if (!qs) return null;
  const q = qs[i];

  if (!q) {
    const finish = async () => {
      if (taskId) await setTaskDone(taskId, true);
      router.back();
    };
    return (
      <Screen>
        <T v="title">{qs.length ? t('quiz.doneTitle') : t('quiz.none')}</T>
        {qs.length > 0 && <T v="heading">{t('quiz.score', { score, total: qs.length })}</T>}
        <T v="muted">{qs.length ? t('quiz.doneBody') : t('quiz.noneBody')}</T>
        <Button label={t('common.continue')} onPress={finish} />
      </Screen>
    );
  }

  const open = q.options.length === 0; // past-paper theory question
  const next = () => {
    setI((n) => n + 1);
    setPicked(null);
    setRevealed(false);
  };

  const choose = async (idx: number) => {
    if (picked != null) return;
    setPicked(idx);
    const ok = idx === q.answer_index;
    if (ok) setScore((s) => s + 1);
    await recordAttempt(q.id, ok);
  };

  const selfMark = async (ok: boolean) => {
    if (ok) setScore((s) => s + 1);
    await recordAttempt(q.id, ok);
    next();
  };

  return (
    <Screen>
      <T v="small">{t('quiz.progress', { n: i + 1, total: qs.length })}{q.topic ? ` · ${q.topic}` : ''}{q.source === 'past' ? ` · ${t('quiz.pastLabel')}` : ''}</T>
      <Card style={{ padding: Space.lg }}>
        <T v="heading" style={{ lineHeight: 26 }}>{q.question}</T>
      </Card>

      {!open &&
        q.options.map((opt, idx) => {
          const isAnswer = idx === q.answer_index;
          const isPicked = idx === picked;
          const border = picked == null ? c.border : isAnswer ? c.primary : isPicked ? c.danger : c.border;
          return (
            <Pressable
              key={idx}
              onPress={() => choose(idx)}
              accessibilityRole="button"
              style={[styles.option, { borderColor: border, backgroundColor: c.card, borderWidth: picked != null && (isAnswer || isPicked) ? 2 : 1 }]}>
              <T v="body" style={{ fontWeight: '700', width: 22 }}>{'ABCD'[idx]}</T>
              <T v="body" style={{ flex: 1 }}>{opt}</T>
              {picked != null && isAnswer && <T style={{ color: c.primary }}>✓</T>}
              {picked != null && isPicked && !isAnswer && <T style={{ color: c.danger }}>✕</T>}
            </Pressable>
          );
        })}

      {!open && picked != null && (
        <>
          <Card>
            <T v="small" style={{ color: picked === q.answer_index ? c.primary : c.danger, fontWeight: '700' }}>
              {picked === q.answer_index ? t('quiz.correct') : t('quiz.wrong')}
            </T>
            <T v="body">{q.explanation}</T>
          </Card>
          <Button label={t('quiz.next')} onPress={next} />
        </>
      )}

      {open && !revealed && (
        <>
          <T v="muted">{t('quiz.openHint')}</T>
          <Button label={t('quiz.showAnswer')} onPress={() => setRevealed(true)} />
        </>
      )}
      {open && revealed && (
        <>
          <Card>
            <T v="small" style={{ fontWeight: '700' }}>{t('quiz.modelAnswer')}</T>
            <T v="body" selectable>{q.explanation}</T>
          </Card>
          <T v="small" style={{ textAlign: 'center' }}>{t('quiz.didYouGetIt')}</T>
          <View style={{ flexDirection: 'row', gap: Space.sm }}>
            <Button kind="ghost" label={t('quiz.missed')} onPress={() => selfMark(false)} style={{ flex: 1 }} />
            <Button label={t('quiz.gotIt')} onPress={() => selfMark(true)} style={{ flex: 1 }} />
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, borderRadius: Radius.md, padding: Space.md, minHeight: 56 },
});
