/**
 * Premium billing through Flutterwave (₦1,500 for 30 days).
 *
 *  POST {action:'checkout'}            (signed-in) → { link, tx_ref }  — open link in a browser
 *  POST {action:'verify', tx_ref}      (signed-in) → { premium_until } — app calls this when the browser closes
 *  POST  with `verif-hash` header      Flutterwave webhook → grants premium
 *  GET  ?return=1                      where Flutterwave sends the student after paying
 *
 * Deploy with --no-verify-jwt (the webhook has no Supabase JWT); user actions check auth themselves.
 * Secrets: FLW_SECRET_KEY, FLW_WEBHOOK_HASH (the "Secret hash" set in the Flutterwave dashboard).
 */
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

const PRICE_NGN = 1500;
const DAYS = 30;
const FLW = 'https://api.flutterwave.com/v3';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const flw = (path: string, init: RequestInit = {}) =>
  fetch(`${FLW}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${Deno.env.get('FLW_SECRET_KEY')}`, 'Content-Type': 'application/json' },
  }).then((r) => r.json());

/** Never trust a webhook or redirect on its own: ask Flutterwave, then check amount and currency. */
async function confirm(admin: SupabaseClient, txRef: string): Promise<boolean> {
  const res = await flw(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);
  const d = res?.data;
  if (res?.status !== 'success' || d?.status !== 'successful') return false;
  if (d.currency !== 'NGN' || Number(d.amount) < PRICE_NGN || d.tx_ref !== txRef) return false;
  const { error } = await admin.rpc('grant_premium', { p_tx_ref: txRef, p_flw_id: d.id, p_days: DAYS });
  if (error) throw error;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (req.method === 'GET') {
    return new Response('Payment received. You can close this page and go back to Recall.', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // ---------- webhook ----------
  const hash = req.headers.get('verif-hash');
  if (hash !== null) {
    if (hash !== Deno.env.get('FLW_WEBHOOK_HASH')) return json({ error: 'bad signature' }, 401);
    const evt = await req.json().catch(() => null);
    const txRef = evt?.data?.tx_ref;
    if (evt?.event === 'charge.completed' && typeof txRef === 'string') {
      try {
        await confirm(admin, txRef);
      } catch (e) {
        console.error('webhook confirm failed', txRef, e);
        return json({ error: 'retry' }, 500); // Flutterwave retries non-200s
      }
    }
    return json({ ok: true });
  }

  // ---------- signed-in student ----------
  const userDb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth } = await userDb.auth.getUser();
  const user = auth.user;
  if (!user) return json({ error: 'unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));

  if (body.action === 'checkout') {
    const txRef = `recall-${user.id.slice(0, 8)}-${Date.now()}`;
    const { error } = await admin.from('payments').insert({ tx_ref: txRef, user_id: user.id, amount: PRICE_NGN });
    if (error) return json({ error: error.message }, 500);
    const { data: profile } = await admin.from('profiles').select('name').eq('id', user.id).maybeSingle();
    const res = await flw('/payments', {
      method: 'POST',
      body: JSON.stringify({
        tx_ref: txRef,
        amount: PRICE_NGN,
        currency: 'NGN',
        redirect_url: `${url}/functions/v1/billing?return=1`,
        payment_options: 'card,banktransfer,ussd',
        customer: { email: user.email, name: profile?.name ?? undefined },
        customizations: { title: 'Recall Premium', description: '30 days of unlimited AI study help' },
        meta: { user_id: user.id },
      }),
    });
    if (res?.status !== 'success' || !res?.data?.link) return json({ error: res?.message ?? 'checkout failed' }, 502);
    return json({ link: res.data.link, tx_ref: txRef });
  }

  if (body.action === 'verify' && typeof body.tx_ref === 'string') {
    const { data: pay } = await userDb.from('payments').select('status').eq('tx_ref', body.tx_ref).maybeSingle();
    if (!pay) return json({ error: 'not found' }, 404);
    if (pay.status !== 'successful') {
      try { await confirm(admin, body.tx_ref); } catch (e) { return json({ error: String(e) }, 502); }
    }
    const { data: sub } = await userDb.from('subscriptions').select('premium_until').eq('user_id', user.id).maybeSingle();
    return json({ premium_until: sub?.premium_until ?? null });
  }

  return json({ error: 'unknown action' }, 400);
});
