import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Field, Screen, T } from '@/components/ui';
import { useColors } from '@/constants/theme';
import { joinGroup } from '@/lib/groups';
import { groupErrorText } from '@/lib/group-errors';
import { useSync } from '@/state/sync';

/** Opened from the Groups tab, or from an invite link: recall://group/join?code=K7PQ2M */
export default function JoinGroup() {
  const { code: linkCode } = useLocalSearchParams<{ code?: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useSync();
  const [code, setCode] = useState((linkCode ?? '').toUpperCase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await joinGroup(code);
      router.replace(`/group/${id}`);
    } catch (e) {
      setError(groupErrorText(e, t));
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <Screen>
        <T v="muted">{t('groups.signIn')}</T>
        <Button label={t('account.signIn')} onPress={() => router.push('/account')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Field
        label={t('groups.code')}
        placeholder={t('groups.codePh')}
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        autoCapitalize="characters"
        maxLength={6}
        autoFocus={!linkCode}
      />
      <Button label={busy ? '…' : t('groups.joinBtn')} onPress={join} disabled={code.length !== 6 || busy} />
      {error && <T v="small" style={{ color: c.danger }}>{error}</T>}
    </Screen>
  );
}
