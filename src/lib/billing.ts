import * as WebBrowser from 'expo-web-browser';

import { kvGet, kvSet } from '@/db/kv';
import { supabase } from '@/lib/supabase';

export type Plan = {
  premium_until: string | null;
  month: string;
  used: { lecture: number; tutor: number };
  limits: { lecture: number; tutor: number };
};

/** True when a supabase.functions.invoke error is the server's "free limit reached" (HTTP 402). */
export const isQuotaError = (error: unknown) =>
  (error as { context?: { status?: number } } | null)?.context?.status === 402;

export const isPremium = (p: Plan | null) => !!p?.premium_until && new Date(p.premium_until) > new Date();

/** Last known plan, for offline display. */
export async function cachedPlan(): Promise<Plan | null> {
  const raw = await kvGet('plan');
  return raw ? (JSON.parse(raw) as Plan) : null;
}

export async function fetchPlan(): Promise<Plan | null> {
  if (!supabase) return cachedPlan();
  const { data, error } = await supabase.rpc('my_plan');
  if (error || !data) return cachedPlan();
  await kvSet('plan', JSON.stringify(data));
  return data as Plan;
}

/**
 * Opens Flutterwave checkout in an in-app browser. When the student closes it,
 * asks the server to confirm with Flutterwave (the webhook usually beats us to it).
 */
export async function buyPremium(): Promise<'paid' | 'pending' | 'error'> {
  if (!supabase) return 'error';
  const { data, error } = await supabase.functions.invoke('billing', { body: { action: 'checkout' } });
  if (error || !data?.link) return 'error';
  await kvSet('pending_tx', data.tx_ref);
  await WebBrowser.openBrowserAsync(data.link);
  return verifyPending();
}

/** Re-checks a payment the student may have finished after leaving the browser. */
export async function verifyPending(): Promise<'paid' | 'pending' | 'error'> {
  const txRef = await kvGet('pending_tx');
  if (!supabase || !txRef) return 'pending';
  const { data, error } = await supabase.functions.invoke('billing', { body: { action: 'verify', tx_ref: txRef } });
  if (error) return 'error';
  if (data?.premium_until && new Date(data.premium_until) > new Date()) {
    await kvSet('pending_tx', '');
    await fetchPlan();
    return 'paid';
  }
  return 'pending';
}
