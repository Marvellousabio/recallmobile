/**
 * Append-only list of schema migrations. Never edit a shipped entry —
 * add a new one. Index + 1 = PRAGMA user_version after it runs.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE profile (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    university TEXT,
    department TEXT,
    level TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    interests TEXT NOT NULL DEFAULT '[]',
    analogies_enabled INTEGER NOT NULL DEFAULT 1,
    onboarded INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE courses (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    lecturer TEXT,
    units INTEGER,
    color TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE timetable_slots (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id),
    weekday INTEGER NOT NULL,      -- 0 = Sunday … 6 = Saturday
    start_min INTEGER NOT NULL,    -- minutes from midnight
    end_min INTEGER NOT NULL,
    venue TEXT,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_slots_day ON timetable_slots(weekday, start_min);

  CREATE TABLE lectures (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id),
    slot_id TEXT REFERENCES timetable_slots(id),
    date TEXT NOT NULL,            -- YYYY-MM-DD
    title TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'captured',
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE assets (
    id TEXT PRIMARY KEY,
    lecture_id TEXT NOT NULL REFERENCES lectures(id),
    kind TEXT NOT NULL,            -- audio | slide | photo
    local_uri TEXT NOT NULL,
    remote_url TEXT,
    upload_state TEXT NOT NULL DEFAULT 'pending',
    size_bytes INTEGER,
    duration_ms INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE ai_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sync_outbox (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    row_id TEXT NOT NULL,
    op TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // 2 — lecture capture: ordered audio segments, file metadata
  `
  ALTER TABLE assets ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE assets ADD COLUMN name TEXT;
  ALTER TABLE assets ADD COLUMN mime TEXT;
  CREATE INDEX idx_assets_lecture ON assets(lecture_id, kind, seq);
  CREATE UNIQUE INDEX idx_lecture_slot_date ON lectures(course_id, slot_id, date) WHERE deleted = 0;
  `,
  // 3 — device settings and sync bookkeeping
  `
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // 4 — AI study packs + spaced-repetition state (FSRS, on device)
  `
  ALTER TABLE lectures ADD COLUMN recall_dump TEXT;

  CREATE TABLE lecture_ai (
    lecture_id TEXT PRIMARY KEY REFERENCES lectures(id),
    summary TEXT NOT NULL,
    key_points TEXT NOT NULL,
    emphasised TEXT NOT NULL,
    topics TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    lecture_id TEXT NOT NULL REFERENCES lectures(id),
    course_id TEXT NOT NULL REFERENCES courses(id),
    topic TEXT,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    due TEXT NOT NULL,
    stability REAL NOT NULL DEFAULT 0,
    difficulty REAL NOT NULL DEFAULT 0,
    elapsed_days INTEGER NOT NULL DEFAULT 0,
    scheduled_days INTEGER NOT NULL DEFAULT 0,
    learning_steps INTEGER NOT NULL DEFAULT 0,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    state INTEGER NOT NULL DEFAULT 0,
    last_review TEXT
  );
  CREATE INDEX idx_cards_due ON cards(due);
  CREATE INDEX idx_cards_course ON cards(course_id, due);

  CREATE TABLE questions (
    id TEXT PRIMARY KEY,
    lecture_id TEXT NOT NULL REFERENCES lectures(id),
    course_id TEXT NOT NULL REFERENCES courses(id),
    topic TEXT,
    question TEXT NOT NULL,
    options TEXT NOT NULL,
    answer_index INTEGER NOT NULL,
    explanation TEXT NOT NULL
  );

  CREATE TABLE review_logs (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    state INTEGER NOT NULL,
    reviewed_at TEXT NOT NULL,
    next_due TEXT NOT NULL
  );
  `,
  // 5 — past papers, exams + study plans, quizzes, tutor
  `
  ALTER TABLE lectures ADD COLUMN kind TEXT NOT NULL DEFAULT 'lecture';
  ALTER TABLE questions ADD COLUMN source TEXT NOT NULL DEFAULT 'generated';

  CREATE TABLE exams (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id),
    kind TEXT NOT NULL,
    date TEXT NOT NULL,
    title TEXT,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE plan_tasks (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL REFERENCES exams(id),
    date TEXT NOT NULL,
    kind TEXT NOT NULL,          -- learn | quiz | past | weak | mock
    ref_id TEXT,                 -- lecture id for learn/quiz/past
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    done_at TEXT
  );
  CREATE INDEX idx_plan_day ON plan_tasks(exam_id, date);

  CREATE TABLE quiz_attempts (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL,
    correct INTEGER NOT NULL,
    at TEXT NOT NULL
  );

  CREATE TABLE tutor_messages (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id),
    role TEXT NOT NULL,          -- user | assistant
    content TEXT NOT NULL,
    state TEXT NOT NULL,         -- sent | pending | failed
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_tutor_course ON tutor_messages(course_id, created_at);
  `,
  // 6 — study groups: offline cache of groups/shares + lectures downloaded from them
  `
  CREATE TABLE group_cache (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    members TEXT NOT NULL DEFAULT '[]',
    fetched_at TEXT NOT NULL
  );
  CREATE TABLE group_share_cache (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_share_cache_group ON group_share_cache(group_id, created_at);
  CREATE TABLE group_downloads (
    share_id TEXT PRIMARY KEY,
    lecture_id TEXT NOT NULL,
    downloaded_at TEXT NOT NULL
  );
  `,
];
