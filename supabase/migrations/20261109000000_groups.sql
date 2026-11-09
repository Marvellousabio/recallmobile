-- Study groups (free for now). Classmates join with an invite code/link.
-- A member "shares" one of their lectures: a snapshot of its study pack plus
-- the storage paths of its files. Other members download that snapshot into
-- their own phone and study it offline with their own recall schedule.

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  invite_code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index on public.group_members (user_id);

create table public.group_shares (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  shared_by uuid not null references auth.users(id) on delete cascade default auth.uid(),
  sharer_name text not null,
  kind text not null default 'lecture' check (kind in ('lecture', 'past_paper')),
  title text,
  course_code text not null,
  course_title text not null,
  date date not null,
  notes text,
  pack jsonb,                         -- {summary, key_points, emphasised, topics, cards[], questions[]} or null
  files jsonb not null default '[]',  -- [{storage_path, kind, name, mime, seq, size_bytes, duration_ms}]
  created_at timestamptz not null default now()
);
create index on public.group_shares (group_id, created_at desc);

-- Membership check that bypasses RLS (avoids policy recursion on group_members).
create or replace function public.is_group_member(p_group uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = p_group and user_id = auth.uid())
$$;

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_shares enable row level security;

create policy "members read group" on public.groups for select using (is_group_member(id));
create policy "owner renames group" on public.groups for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes group" on public.groups for delete using (owner_id = auth.uid());

create policy "members see members" on public.group_members for select using (is_group_member(group_id));
-- Leave a group yourself, or the owner removes someone. Joining goes through join_group().
create policy "leave or remove" on public.group_members for delete using (
  user_id = auth.uid() or exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid())
);

create policy "members read shares" on public.group_shares for select using (is_group_member(group_id));
create policy "members share" on public.group_shares for insert
  with check (shared_by = auth.uid() and is_group_member(group_id));
create policy "sharer or owner unshares" on public.group_shares for delete using (
  shared_by = auth.uid() or exists (select 1 from groups g where g.id = group_id and g.owner_id = auth.uid())
);

/** Creates a group with a fresh 6-character invite code; the caller becomes owner. */
create or replace function public.create_group(p_name text, p_display_name text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  g groups;
  code text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  loop
    -- No 0/O/1/I so codes are easy to read out in class.
    code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
             from generate_series(1, 6));
    exit when not exists (select 1 from groups where invite_code = code);
  end loop;
  insert into groups (name, invite_code, owner_id) values (trim(p_name), code, uid) returning * into g;
  insert into group_members (group_id, user_id, display_name, role) values (g.id, uid, p_display_name, 'owner');
  return g;
end $$;

/** Joins by invite code. Idempotent. Returns the group id, or null for an unknown code. */
create or replace function public.join_group(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select id into gid from groups where invite_code = upper(trim(p_code));
  if gid is null then return null; end if;
  insert into group_members (group_id, user_id, display_name) values (gid, uid, p_display_name)
  on conflict (group_id, user_id) do nothing;
  return gid;
end $$;

revoke execute on function public.create_group(text, text) from anon;
revoke execute on function public.join_group(text, text) from anon;

-- Members may read the recordings/slides of lectures shared into their groups.
create policy "group shared files read" on storage.objects for select using (
  bucket_id = 'lecture-files' and exists (
    select 1 from public.group_shares s
    where public.is_group_member(s.group_id)
      and s.files @> jsonb_build_array(jsonb_build_object('storage_path', storage.objects.name))
  )
);
