import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Screen, T } from '@/components/ui';
import { Radius, Space, useColors } from '@/constants/theme';
import { buyPremium, cachedPlan, fetchPlan, isPremium, Plan, verifyPending } from '@/lib/billing';
import { useSync } from '@/state/sync';

function Meter({ used, limit }: { used: number; limit: number }) {
  const c = useColors();
  const pct = Math.min(1, used / Math.max(1, limit));
  return (
    <View style={{ height: 8, borderRadius: Radius.sm, backgroundColor: c.border, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: pct >= 1 ? c.danger : c.primary }} />
    </View>
  );
}

export default function Premium() {
  const { t } = useTranslation();
  const { session, sync } = useSync();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    cachedPlan().then(setPlan);
    fetchPlan().then(setPlan);
    // A payment finished after the student left the browser shows up here.
    verifyPending().then((r) => { if (r === 'paid') fetchPlan().then(setPlan); });
  }, []);

  const pay = async () => {
    setBusy(true);
    setMsg(null);
    const r = await buyPremium();
    setMsg(r === 'paid' ? t('premium.paid') : r === 'pending' ? t('premium.notYet') : t('premium.error'));
    setPlan(await fetchPlan());
    setBusy(false);
    if (r === 'paid') sync(); // lets held-back lectures process right away
  };

  const premium = isPremium(plan);
  const until = plan?.premium_until ? new Date(plan.premium_until).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';

  return (
    <Screen>
      <T v="title">{t('premium.title')}</T>
      <T v="heading">{t('premium.price')}</T>
      <T v="muted">{t('premium.pitch')}</T>

      {plan && (
        <Card style={{ gap: Space.sm }}>
          <T v="body" style={{ fontWeight: '600' }}>{premium ? t('premium.activeUntil', { date: until }) : t('premium.free')}</T>
          {!premium && (
            <>
              <T v="small">{t('premium.lectures', { used: plan.used.lecture, limit: plan.limits.lecture })}</T>
              <Meter used={plan.used.lecture} limit={plan.limits.lecture} />
              <T v="small">{t('premium.tutor', { used: plan.used.tutor, limit: plan.limits.tutor })}</T>
              <Meter used={plan.used.tutor} limit={plan.limits.tutor} />
            </>
          )}
        </Card>
      )}

      {!session ? (
        <Card style={{ gap: Space.sm }}>
          <T v="muted">{t('premium.signIn')}</T>
          <Button label={t('account.signIn')} onPress={() => router.push('/account')} />
        </Card>
      ) : (
        <Button
          label={busy ? t('premium.checking') : premium ? t('premium.extend') : t('premium.upgrade')}
          onPress={pay}
          disabled={busy}
        />
      )}
      {msg && <T v="muted">{msg}</T>}
    </Screen>
  );
}
