-- Recall v2 — cloud mirror of the on-device database.
-- The phone is the source of truth; this is backup + multi-device sync.
-- Every row belongs to one user and is protected by row-level security.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  local_id text,
  name text not null,
  university text,
  department text,
  level text,
  language text not null default 'en',
  interests jsonb not null default '[]',
  analogies_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  code text not null,
  title text not null,
  lecturer text,
  units int,
  color text not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.timetable_slots (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_min int not null,
  end_min int not null check (end_min > start_min),
  venue text,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.lectures (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  slot_id uuid references public.timetable_slots(id) on delete set null,
  date date not null,
  title text,
  notes text,
  status text not null default 'captured',
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  kind text not null check (kind in ('audio', 'slide', 'photo')),
  storage_path text not null,
  name text,
  mime text,
  seq int not null default 0,
  size_bytes bigint,
  duration_ms int,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create index on public.courses (user_id, updated_at);
create index on public.timetable_slots (user_id, updated_at);
create index on public.lectures (user_id, updated_at);
create index on public.assets (user_id, updated_at);

-- Row-level security: users only see and write their own rows.
do $$
declare t text;
begin
  foreach t in array array['courses', 'timetable_slots', 'lectures', 'assets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());

-- Private storage for lecture recordings, slides and photos.
-- Path convention: {user_id}/{lecture_id}/{asset_id}.{ext}
insert into storage.buckets (id, name, public, file_size_limit)
values ('lecture-files', 'lecture-files', false, 104857600)
on conflict (id) do nothing;

create policy "own files read" on storage.objects for select
  using (bucket_id = 'lecture-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files write" on storage.objects for insert
  with check (bucket_id = 'lecture-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files update" on storage.objects for update
  using (bucket_id = 'lecture-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files delete" on storage.objects for delete
  using (bucket_id = 'lecture-files' and (storage.foldername(name))[1] = auth.uid()::text);
