import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Field, Screen, T } from '@/components/ui';
import { useColors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

/** Email one-time-code sign in. Phone OTP comes when we add an SMS provider (Termii). */
export default function Account() {
  const { t } = useTranslation();
  const c = useColors();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  const sendCode = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (e) setError(e.message.toLowerCase().includes('network') ? t('account.offline') : e.message);
    else setSent(true);
  };

  const verify = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (e) setError(t('account.badCode'));
    else router.back();
  };

  return (
    <Screen>
      <T v="title">{t('account.title')}</T>
      <T v="muted">{t('account.why')}</T>
      {!sent ? (
        <>
          <Field label={t('account.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoFocus />
          <Button label={busy ? '…' : t('account.sendCode')} onPress={sendCode} disabled={!validEmail || busy} />
        </>
      ) : (
        <>
          <T v="body">{t('account.codeSent', { email: email.trim() })}</T>
          <Field label={t('account.code')} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8} autoComplete="one-time-code" autoFocus />
          <Button label={busy ? '…' : t('account.verify')} onPress={verify} disabled={code.trim().length < 6 || busy} />
          <Button kind="ghost" label={t('account.changeEmail')} onPress={() => { setSent(false); setCode(''); }} />
        </>
      )}
      {error && <T v="small" style={{ color: c.danger }}>{error}</T>}
    </Screen>
  );
}
