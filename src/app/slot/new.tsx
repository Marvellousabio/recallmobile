import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Chip, Field, Screen, T } from '@/components/ui';
import { Space, useColors } from '@/constants/theme';
import { addSlot, formatTime } from '@/db/repo';

const ORDER = [1, 2, 3, 4, 5, 6, 0];
// 7:00 AM → 8:00 PM in 30-minute steps
const TIMES = Array.from({ length: 27 }, (_, i) => 7 * 60 + i * 30);

function TimePicker({ label, value, onChange }: { label: string; value: number; onChange: (m: number) => void }) {
  return (
    <View style={{ gap: Space.sm }}>
      <T v="small">{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs }}>
        {TIMES.map((m) => (
          <Chip key={m} label={formatTime(m)} selected={m === value} onPress={() => onChange(m)} />
        ))}
      </View>
    </View>
  );
}

export default function NewSlot() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const short = t('daysShort', { returnObjects: true }) as string[];
  const [weekday, setWeekday] = useState(1);
  const [start, setStart] = useState(8 * 60);
  const [end, setEnd] = useState(10 * 60);
  const [venue, setVenue] = useState('');
  const valid = end > start;

  const save = async () => {
    await addSlot({ course_id: courseId, weekday, start_min: start, end_min: end, venue: venue.trim() || null });
    router.back();
  };

  return (
    <Screen>
      <T v="small">{t('timetable.day')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs }}>
        {ORDER.map((d) => (
          <Chip key={d} label={short[d]} selected={d === weekday} onPress={() => setWeekday(d)} />
        ))}
      </View>
      <TimePicker label={t('timetable.start')} value={start} onChange={(m) => { setStart(m); if (end <= m) setEnd(m + 120); }} />
      <TimePicker label={t('timetable.end')} value={end} onChange={setEnd} />
      {!valid && <T v="small" style={{ color: c.danger }}>{t('timetable.endAfterStart')}</T>}
      <Field label={t('timetable.venue')} placeholder={t('timetable.venuePh')} value={venue} onChangeText={setVenue} />
      <Button label={t('common.save')} onPress={save} disabled={!valid} />
    </Screen>
  );
}
