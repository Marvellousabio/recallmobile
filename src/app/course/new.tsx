import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Field, Screen } from '@/components/ui';
import { addCourse } from '@/db/repo';

export default function NewCourse() {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [lecturer, setLecturer] = useState('');
  const [units, setUnits] = useState('');

  const save = async () => {
    const id = await addCourse({
      code,
      title,
      lecturer: lecturer.trim() || null,
      units: units ? parseInt(units, 10) || null : null,
    });
    router.replace(`/course/${id}`);
  };

  return (
    <Screen>
      <Field label={t('courses.code')} placeholder={t('courses.codePh')} value={code} onChangeText={setCode} autoCapitalize="characters" autoFocus />
      <Field label={t('courses.name')} placeholder={t('courses.namePh')} value={title} onChangeText={setTitle} />
      <Field label={t('courses.lecturer')} value={lecturer} onChangeText={setLecturer} />
      <Field label={t('courses.units')} value={units} onChangeText={setUnits} keyboardType="number-pad" maxLength={1} />
      <Button label={t('common.save')} onPress={save} disabled={!code.trim() || !title.trim()} />
    </Screen>
  );
}
