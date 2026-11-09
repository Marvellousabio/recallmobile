# Premium & Flutterwave setup

Free plan: 10 AI-processed lectures + 30 tutor questions per month (Lagos time).
Premium: ₦1,500 for 30 days, unlimited. Paying again adds 30 days on top.
Limits live in `plan_limits()` in `supabase/migrations/20261108030000_billing.sql`; price in `supabase/functions/billing/index.ts`.

## 1. Database
```
npx supabase db push
```

## 2. Flutterwave dashboard
1. Settings → API keys: copy the **Secret key** (use the test key first).
2. Settings → Webhooks:
   - URL: `https://<project-ref>.supabase.co/functions/v1/billing`
   - Secret hash: any long random string you make up.
   - Tick "charge.completed".

## 3. Secrets and deploy
```
npx supabase secrets set FLW_SECRET_KEY=FLWSECK_TEST-xxxx FLW_WEBHOOK_HASH=<your secret hash>
npx supabase functions deploy billing --no-verify-jwt
npx supabase functions deploy process-lecture
npx supabase functions deploy tutor
```
`--no-verify-jwt` is required for `billing` only: Flutterwave's webhook has no Supabase login. The function checks the
login itself for checkout/verify, and checks the secret hash for the webhook.

## 4. Test
Me → Recall Premium → Pay. In test mode pay with one of the test cards listed in Flutterwave's docs
(developer.flutterwave.com → "Testing helpers").
After paying, close the browser; the screen should say "Payment confirmed".

Switch to the live secret key when ready. Nothing else changes.
