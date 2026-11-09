import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Empty, Screen, T } from '@/components/ui';
import { Space, useColors } from '@/constants/theme';
import { shareableLectures, shareLecture } from '@/lib/groups';
import { groupErrorText } from '@/lib/group-errors';

type Row = Awaited<ReturnType<typeof shareableLectures>>[number];

export default function ShareToGroup() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [withAudio, setWithAudio] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    shareableLectures().then(setRows);
  }, []);

  const share = async (r: Row) => {
    setBusy(r.id);
    setError(null);
    try {
      await shareLecture(groupId, r.id, withAudio);
      router.back();
    } catch (e) {
      setError(groupErrorText(e, t));
      setBusy(null);
    }
  };

  return (
    <Screen>
      <T v="heading">{t('groups.pickLecture')}</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md }}>
        <T v="body" style={{ flex: 1 }}>{t('groups.withAudio')}</T>
        <Switch value={withAudio} onValueChange={setWithAudio} trackColor={{ true: c.primary }} />
      </View>
      {busy && <T v="small">{t('groups.sharing')}</T>}
      {error && <T v="small" style={{ color: c.danger }}>{error}</T>}
      {rows?.length === 0 && <Empty text={t('groups.noLectures')} />}
      {rows?.map((r) => (
        <Card key={r.id} onPress={busy ? undefined : () => share(r)} style={{ opacity: busy && busy !== r.id ? 0.5 : 1 }}>
          <T v="body" style={{ fontWeight: '600' }}>{r.code} · {r.title ?? r.date}</T>
          <T v="small">
            {[r.date, r.status === 'ready' && `✓ ${t('ai.ready')}`, r.files > 0 && t('groups.files', { count: r.files })].filter(Boolean).join(' · ')}
          </T>
        </Card>
      ))}
    </Screen>
  );
}
