-- Premium (₦1,500 / 30 days via Flutterwave) and free-tier AI limits.
-- Students can only READ their own plan/usage; all writes go through
-- security-definer functions or the service role (webhook).

create table public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  premium_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.payments (
  tx_ref text primary key,              -- our reference, sent to Flutterwave
  user_id uuid not null references auth.users on delete cascade,
  amount numeric not null,
  currency text not null default 'NGN',
  status text not null default 'pending', -- pending | successful | failed
  flw_transaction_id bigint unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per counted AI use. A lecture counts once per month even if re-processed.
create table public.ai_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('lecture', 'tutor')),
  ref_id text not null,
  month text not null,                  -- 'YYYY-MM' (Africa/Lagos)
  created_at timestamptz not null default now(),
  unique (user_id, kind, ref_id, month)
);
create index on public.ai_usage (user_id, month, kind);

alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.ai_usage enable row level security;
create policy "own plan" on public.subscriptions for select using (auth.uid() = user_id);
create policy "own payments" on public.payments for select using (auth.uid() = user_id);
create policy "own usage" on public.ai_usage for select using (auth.uid() = user_id);

create or replace function public.current_month() returns text
language sql stable as $$ select to_char(now() at time zone 'Africa/Lagos', 'YYYY-MM') $$;

create or replace function public.plan_limits() returns jsonb
language sql immutable as $$ select '{"lecture": 10, "tutor": 30}'::jsonb $$;

/** What the app shows on the Premium screen. */
create or replace function public.my_plan() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'premium_until', (select premium_until from subscriptions where user_id = auth.uid() and premium_until > now()),
    'month', current_month(),
    'used', jsonb_build_object(
      'lecture', (select count(*) from ai_usage where user_id = auth.uid() and month = current_month() and kind = 'lecture'),
      'tutor',   (select count(*) from ai_usage where user_id = auth.uid() and month = current_month() and kind = 'tutor')
    ),
    'limits', plan_limits()
  )
$$;

/**
 * Records one AI use and says whether it's allowed. Premium is unlimited.
 * Re-using the same ref this month is free (retries, re-processing).
 * Serialised per user with an advisory lock so parallel calls can't overshoot.
 */
create or replace function public.consume_ai(p_kind text, p_ref text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  m text := current_month();
  used int;
begin
  if uid is null then return false; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  if exists (select 1 from ai_usage where user_id = uid and kind = p_kind and ref_id = p_ref and month = m) then
    return true;
  end if;
  if not exists (select 1 from subscriptions where user_id = uid and premium_until > now()) then
    select count(*) into used from ai_usage where user_id = uid and kind = p_kind and month = m;
    if used >= (plan_limits() ->> p_kind)::int then return false; end if;
  end if;
  insert into ai_usage (user_id, kind, ref_id, month) values (uid, p_kind, p_ref, m);
  return true;
end $$;

/** Called by the webhook (service role) after Flutterwave confirms payment. Idempotent. */
create or replace function public.grant_premium(p_tx_ref text, p_flw_id bigint, p_days int default 30) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  update payments set status = 'successful', flw_transaction_id = p_flw_id, updated_at = now()
    where tx_ref = p_tx_ref and status <> 'successful'
    returning user_id into uid;
  if uid is null then return; end if; -- unknown or already applied
  insert into subscriptions (user_id, premium_until) values (uid, now() + make_interval(days => p_days))
  on conflict (user_id) do update
    set premium_until = greatest(subscriptions.premium_until, now()) + make_interval(days => p_days),
        updated_at = now();
end $$;

revoke execute on function public.grant_premium(text, bigint, int) from public, anon, authenticated;
