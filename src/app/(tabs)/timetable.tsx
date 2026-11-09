import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SlotRow } from '@/components/slot-row';
import { Empty, Screen, T } from '@/components/ui';
import { Space } from '@/constants/theme';
import { listSlots, SlotWithCourse } from '@/db/repo';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

export default function Timetable() {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<SlotWithCourse[]>([]);
  const days = t('days', { returnObjects: true }) as string[];

  useFocusEffect(
    useCallback(() => {
      listSlots().then(setSlots);
    }, []),
  );

  return (
    <Screen>
      <T v="title">{t('timetable.title')}</T>
      {slots.length === 0 && <Empty text={t('timetable.empty')} />}
      {ORDER.map((d) => {
        const day = slots.filter((s) => s.weekday === d);
        if (!day.length) return null;
        return [
          <T key={`h${d}`} v="heading" style={{ marginTop: Space.sm }}>{days[d]}</T>,
          ...day.map((s) => <SlotRow key={s.id} s={s} onPress={() => router.push(`/course/${s.course_id}`)} />),
        ];
      })}
    </Screen>
  );
}
