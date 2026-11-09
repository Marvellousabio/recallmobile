import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Field, Screen, T } from '@/components/ui';
import { useColors } from '@/constants/theme';
import { createGroup } from '@/lib/groups';
import { groupErrorText } from '@/lib/group-errors';

export default function NewGroup() {
  const { t } = useTranslation();
  const c = useColors();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await createGroup(name);
      router.replace(`/group/${id}`);
    } catch (e) {
      setError(groupErrorText(e, t));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Field label={t('groups.name')} placeholder={t('groups.namePh')} value={name} onChangeText={setName} maxLength={80} autoFocus />
      <Button label={busy ? '…' : t('groups.create')} onPress={create} disabled={!name.trim() || busy} />
      {error && <T v="small" style={{ color: c.danger }}>{error}</T>}
    </Screen>
  );
}
