import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Empty, Screen, T } from '@/components/ui';
import { Space } from '@/constants/theme';
import { cachedGroups, Group, refreshGroups } from '@/lib/groups';
import { useSync } from '@/state/sync';

export default function Groups() {
  const { t } = useTranslation();
  const { enabled, session } = useSync();
  const [groups, setGroups] = useState<Group[]>([]);
  const [offline, setOffline] = useState(false);

  useFocusEffect(
    useCallback(() => {
      cachedGroups().then(setGroups);
      refreshGroups()
        .then((ok) => { setOffline(!ok); return cachedGroups(); })
        .then(setGroups)
        .catch(() => setOffline(true));
    }, []),
  );

  const signedIn = enabled && !!session;

  return (
    <Screen>
      <T v="title">{t('groups.title')}</T>
      <T v="muted">{t('groups.intro')}</T>
      {signedIn && offline && groups.length > 0 && <T v="small">{t('groups.offlineCached')}</T>}

      {groups.length === 0 && <Empty text={signedIn ? t('groups.empty') : t('groups.signIn')} />}
      {groups.map((g) => (
        <Card key={g.id} onPress={() => router.push(`/group/${g.id}`)}>
          <T v="heading">{g.name}</T>
          <T v="small">{t('groups.members', { count: g.members.length })} · {g.invite_code}</T>
        </Card>
      ))}

      {signedIn ? (
        <View style={{ gap: Space.sm }}>
          <Button label={t('groups.create')} onPress={() => router.push('/group/new')} />
          <Button kind="ghost" label={t('groups.join')} onPress={() => router.push('/group/join')} />
        </View>
      ) : enabled ? (
        <Button label={t('account.signIn')} onPress={() => router.push('/account')} />
      ) : null}
    </Screen>
  );
}
