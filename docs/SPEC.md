# Recall v2 — MVP Specification

## 1. Problem
Hardworking Nigerian university students forget what they learn, so their effort does not translate into results. Causes: resource overload, no timely recall after lectures, and no system that fits busy lives (jobs, fellowships, other duties).

**Goal:** students retain what they learn, are prepared before tests, and enter exams confident.

## 2. Target user
Nigerian university students. Android-first, low-end phones, expensive/unreliable data. Languages: English, Nigerian Pidgin, Yoruba, Hausa, Igbo.

## 3. Principles
1. **Offline-first** — everything except AI processing, sync and sharing works with no internet.
2. **Built around the student's week** — timetable and lectures are the backbone, not a file dump.
3. **Recall is automatic** — the app schedules it; the student just shows up.
4. **Speaks the student's language and world** — UI in 5 languages; AI explains in the chosen language using the student's interests (football, music, Nollywood…).
5. **Data-light** — compressed audio, Wi-Fi-only sync option, small downloads.

## 4. Tech stack
| Layer | Choice |
|---|---|
| App | React Native + Expo (Android first; iOS/web later), TypeScript |
| Local DB | SQLite (expo-sqlite) + Drizzle ORM |
| Sync | Local-first sync to Postgres (PowerSync or custom outbox/changelog) |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions) |
| AI | Claude (latest Sonnet for generation/tutor, Haiku for cheap tasks) |
| Speech-to-text | Hosted STT with Nigerian-English support (evaluate Whisper-class vs. alternatives) |
| Notifications | expo-notifications (local, offline) + push via FCM |
| Email | Resend (or similar); SMS later via Termii |
| Payments | Flutterwave (premium/groups) |
| i18n | i18next, 5 locales, reviewed by native speakers |
| Scheduling | FSRS spaced repetition, runs on-device |

## 5. Features (MVP, in build order)

### M1 — Foundation
- Expo app scaffold, navigation, theming, design system.
- SQLite schema + migrations; sync engine with outbox queue and conflict rule (last-write-wins per field; reviews are append-only).
- Auth: phone or email + OTP; session persists offline.
- i18n: all 5 languages, language switch anytime.
- Onboarding: university, level/department, language, interests, study habits (best study times, commitments).

### M2 — Courses & timetable
- Add courses (code, title, lecturer, units).
- Weekly timetable: course, day, time, venue.
- Home screen = "Today": classes, due recall sessions, upcoming tests.

### M3 — Lecture capture
- Each timetable slot creates a lecture entry when class happens.
- Record lecture audio (background recording, compressed Opus/AAC, chunked so long lectures survive crashes).
- Attach slides (PDF/images/camera photos of the board) and typed notes.
- All stored locally; uploads queued.

### M4 — AI processing (online, queued)
- Transcribe audio (handles Nigerian English and code-switching).
- Extract text from slides (PDF text + OCR for photos).
- Produce per-lecture: summary, key points, "lecturer emphasised" items, flashcards, practice questions.
- Results synced back and cached offline.
- Status visible: queued → processing → ready.

### M5 — Recall engine
- Auto-schedule: ~30 min after class (quick recall), next day, then FSRS-spaced.
- Session types: flashcards, short quiz, "explain it back" (free recall, AI grades when online, self-grade offline).
- All runs offline; review logs sync later.

### M6 — Past questions & exam plans
- Upload past questions; AI maps them to topics and flags frequently-tested areas.
- Set test/exam date per course → AI builds day-by-day plan fitted to the student's free time and timetable.
- Plan adapts when sessions are missed or topics are weak.

### M7 — AI tutor
- Chat per course, grounded in that course's materials (retrieval over transcripts/slides).
- Responds in chosen language; technical terms kept in English.
- Personalised analogies from interests (toggleable).
- Offline: shows cached explanations; new questions queued.

### M8 — Reminders & motivation
- Local notifications for recall sessions and plan tasks (work offline).
- Email digests; streaks; encouraging messages in the student's language.
- Quiet hours respect commitments (work, fellowship).

### M9 — Progress
- Per course: mastery by topic, weak areas, retention trend, exam readiness score.
- Weekly summary.

### M10 — Groups (premium)
- Create a course group; invite classmates by link/code.
- Share lecture captures, AI outputs, past questions; each member keeps a personal recall schedule.
- Flutterwave subscription (monthly/semester); free tier = full personal use.

## 6. Data model (core)
- `users` (language, interests[], university, level, preferences)
- `courses` (code, title, lecturer, owner/group)
- `timetable_slots` (course, weekday, start, end, venue)
- `lectures` (course, date, slot, status)
- `assets` (lecture, type: audio|slide|photo|note, local_uri, remote_url, upload_state)
- `transcripts`, `summaries`, `key_points` (lecture)
- `topics` (course) — linked to lectures and past questions
- `cards` (topic, front, back, source) + `card_states` (FSRS per user)
- `review_logs` (append-only)
- `questions` (topic, source: generated|past, year)
- `exams` (course, date, type) + `plan_tasks` (exam, date, topic, type, done)
- `tutor_threads`, `tutor_messages`
- `groups`, `group_members`, `subscriptions`
- `sync_outbox`, `ai_jobs` (type, input, state, retries)

## 7. Localisation & personalisation
- Translation files reviewed by native speakers per language (team has speakers).
- AI system prompt includes language + interests + level; glossary keeps technical terms in English.
- Quality gate: evaluate Yoruba/Hausa/Igbo tutor output with students before launch; mark "beta" if weak.

## 8. Non-functional
- App size < 40 MB; works on Android 8+, 2 GB RAM.
- Cold start < 3 s on low-end device.
- Audio ~10 MB/hour target.
- Data privacy: recordings private by default; explicit consent text about recording lecturers.
- AI cost controls: Haiku for bulk tasks, caching, per-user monthly quotas on free tier.

## 9. Milestones
| Phase | Scope | Outcome |
|---|---|---|
| A | M1–M3 | Students can set up courses and capture lectures offline |
| B | M4–M5 | Core loop works: capture → AI → automatic recall (**pilot with real students here**) |
| C | M6–M8 | Exam plans, tutor, reminders |
| D | M9–M10 | Progress, groups, Flutterwave, launch |

## 10. Open items
- STT provider choice (test on real Nigerian lecture recordings).
- Sync: PowerSync vs. custom.
- Pricing in Naira for premium.
- Pilot university/department.
