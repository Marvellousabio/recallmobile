import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Empty, Screen, T } from '@/components/ui';
import { Space } from '@/constants/theme';
import { Course, listCourses } from '@/db/repo';

export default function Courses() {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<Course[]>([]);

  useFocusEffect(
    useCallback(() => {
      listCourses().then(setCourses);
    }, []),
  );

  return (
    <Screen>
      <T v="title">{t('courses.title')}</T>
      {courses.length === 0 && <Empty text={t('courses.empty')} />}
      {courses.map((c) => (
        <Card key={c.id} onPress={() => router.push(`/course/${c.id}`)} style={{ flexDirection: 'row', gap: Space.md, alignItems: 'center' }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.color }} />
          <View style={{ flex: 1 }}>
            <T v="heading">{c.code}</T>
            <T v="muted" numberOfLines={1}>{c.title}</T>
          </View>
          {c.units != null && <T v="small">{c.units}u</T>}
        </Card>
      ))}
      <Button label={t('courses.add')} onPress={() => router.push('/course/new')} />
    </Screen>
  );
}
