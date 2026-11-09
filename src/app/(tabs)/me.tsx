import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Chip, Screen, T } from '@/components/ui';
import { getWifiOnly, setWifiOnly } from '@/lib/sync';
import { useSync } from '@/state/sync';
import { Space, useColors } from '@/constants/theme';
import { saveProfile } from '@/db/repo';
import { INTEREST_KEYS, LANGUAGES } from '@/i18n/locales';
import { useApp } from '@/state/app';

export default function Me() {
  const { t } = useTranslation();
  const c = useColors();
  const { profile, refresh } = useApp();
  const s = useSync();
  const [wifiOnly, setWifi] = useState(false);
  useFocusEffect(
    useCallback(() => {
      getWifiOnly().then(setWifi);
      s.sync();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );
  if (!profile) return null;

  const lastSyncLabel = s.lastSync
    ? new Date(s.lastSync).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : t('account.never');
  const skipped = s.lastResult?.skipped;

  const update = async (patch: Partial<typeof profile>) => {
    await saveProfile({ ...profile, ...patch });
    await refresh();
  };

  const toggle = (k: string) =>
    update({ interests: profile.interests.includes(k) ? profile.interests.filter((x) => x !== k) : [...profile.interests, k] });

  return (
    <Screen>
      <T v="title">{t('me.title')}</T>
      <Card>
        <T v="heading">{profile.name}</T>
        <T v="muted">{[profile.department, profile.university, profile.level && `${profile.level}L`].filter(Boolean).join(' · ')}</T>
      </Card>

      <Card onPress={() => router.push('/premium')}>
        <T v="body" style={{ fontWeight: '600' }}>{t('premium.title')} · {t('premium.price')}</T>
        <T v="small">{t('premium.pitch')}</T>
      </Card>

      <T v="heading">{t('me.language')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
        {LANGUAGES.map((l) => (
          <Chip key={l.code} label={l.native} selected={profile.language === l.code} onPress={() => update({ language: l.code })} />
        ))}
      </View>

      <T v="heading">{t('me.interests')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm }}>
        {INTEREST_KEYS.map((k) => (
          <Chip key={k} label={t(`interests.${k}`)} selected={profile.interests.includes(k)} onPress={() => toggle(k)} />
        ))}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md }}>
        <T v="body" style={{ flex: 1 }}>{t('me.analogies')}</T>
        <Switch value={profile.analogies_enabled} onValueChange={(v) => update({ analogies_enabled: v })} trackColor={{ true: c.primary }} />
      </View>

      <T v="heading">{t('account.backup')}</T>
      {!s.enabled ? (
        <Card><T v="muted">{t('account.localOnly')}</T></Card>
      ) : !s.session ? (
        <Card>
          <T v="muted">{t('account.why')}</T>
          <Button label={t('account.signIn')} onPress={() => router.push('/account')} style={{ marginTop: Space.sm }} />
        </Card>
      ) : (
        <Card style={{ gap: Space.sm }}>
          <T v="body" style={{ fontWeight: '600' }}>{s.session.user.email}</T>
          <T v="small">{t('account.lastSync', { when: lastSyncLabel })}</T>
          <T v="small">
            {s.syncing
              ? t('account.syncing')
              : s.pending > 0
                ? t('account.pending', { count: s.pending }) +
                  (skipped === 'offline' ? ` · ${t('account.offline')}` : skipped === 'wifi' ? ` · ${t('account.waitingWifi')}` : '')
                : t('account.upToDate')}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.md }}>
            <T v="body" style={{ flex: 1 }}>{t('account.wifiOnly')}</T>
            <Switch
              value={wifiOnly}
              onValueChange={async (v) => { setWifi(v); await setWifiOnly(v); }}
              trackColor={{ true: c.primary }}
            />
          </View>
          <Button label={t('account.syncNow')} onPress={s.sync} disabled={s.syncing} />
          <Button kind="ghost" label={t('account.signOut')} onPress={s.signOut} />
        </Card>
      )}
    </Screen>
  );
}
