-- AI outputs for lectures. Written only by the process-lecture edge function
-- (service role); students can read their own rows.

-- "What I remember" free-recall text, written on the phone and synced.
alter table public.lectures add column recall_dump text;

create table public.transcripts (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

create table public.lecture_ai (
  lecture_id uuid primary key references public.lectures(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  language text not null,
  summary text not null,
  key_points jsonb not null,
  emphasised jsonb not null,
  topics jsonb not null,
  model text not null,
  updated_at timestamptz not null default now()
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  topic text,
  front text not null,
  back text not null,
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  topic text,
  question text not null,
  options jsonb not null,
  answer_index int not null,
  explanation text not null,
  created_at timestamptz not null default now()
);

create index on public.cards (lecture_id);
create index on public.questions (lecture_id);

do $$
declare t text;
begin
  foreach t in array array['transcripts', 'lecture_ai', 'cards', 'questions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read own" on public.%I for select using (user_id = auth.uid())', t);
  end loop;
end $$;
