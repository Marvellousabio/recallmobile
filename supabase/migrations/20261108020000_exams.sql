-- Past question papers reuse the lecture pipeline (files + AI processing).
alter table public.lectures add column kind text not null default 'lecture'
  check (kind in ('lecture', 'past_paper'));

-- Past-paper questions are open-ended: options = [], answer_index = -1,
-- explanation = model answer.
alter table public.questions add column source text not null default 'generated'
  check (source in ('generated', 'past'));
alter table public.questions alter column answer_index set default -1;

-- Tests and exams set by the student. The study plan itself is generated
-- on the phone (works offline), so only the exam is synced.
create table public.exams (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  kind text not null check (kind in ('test', 'exam')),
  date date not null,
  title text,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create index on public.exams (user_id, updated_at);
alter table public.exams enable row level security;
create policy "own rows" on public.exams for all using (user_id = auth.uid()) with check (user_id = auth.uid());
