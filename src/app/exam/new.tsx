import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Calendar } from '@/components/calendar';
import { Button, Chip, Field, Screen, T } from '@/components/ui';
import { Space } from '@/constants/theme';
import { addExam, getExam } from '@/db/exams';
import { scheduleExamCountdown } from '@/lib/reminders';

export default function NewExam() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const { t } = useTranslation();
  const [kind, setKind] = useState<'test' | 'exam'>('test');
  const [date, setDate] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const save = async () => {
    if (!date) return;
    const id = await addExam({ course_id: courseId, kind, date, title: title.trim() || null });
    const e = await getExam(id);
    if (e) scheduleExamCountdown(e).catch(() => {});
    router.replace(`/exam/${id}`);
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: Space.sm }}>
        <Chip label={t('exam.test')} selected={kind === 'test'} onPress={() => setKind('test')} />
        <Chip label={t('exam.exam')} selected={kind === 'exam'} onPress={() => setKind('exam')} />
      </View>
      <T v="small">{t('exam.when')}</T>
      <Calendar value={date} onChange={setDate} />
      <Field label={t('exam.titleLabel')} placeholder={t('exam.titlePh')} value={title} onChangeText={setTitle} />
      <Button label={t('exam.create')} onPress={save} disabled={!date} />
    </Screen>
  );
}
