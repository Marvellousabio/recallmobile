// Supabase Edge Function: turn one captured lecture into study material.
//   1. Transcribe audio segments (cached per segment in `transcripts`).
//   2. Send transcript + slides (PDF/images) + student notes to Claude.
//   3. Save summary, key points, flashcards and practice questions.
//
// Secrets (supabase secrets set ...): ANTHROPIC_API_KEY, OPENAI_API_KEY (Whisper),
// optional CLAUDE_MODEL. SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected.

import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.6.0/helpers/zod';
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4.6.7';

const MODEL = Deno.env.get('CLAUDE_MODEL') ?? 'claude-opus-5-5';
const BUCKET = 'lecture-files';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  pcm: 'Nigerian Pidgin',
  yo: 'Yoruba',
  ha: 'Hausa',
  ig: 'Igbo',
};

const StudyPack = z.object({
  summary: z.string().describe('6-10 sentence summary of the lecture'),
  key_points: z.array(z.string()).describe('The most important ideas, one per item'),
  emphasised: z
    .array(z.string())
    .describe('Things the lecturer stressed, repeated, or hinted will be examined. Empty if none.'),
  topics: z.array(z.string()).describe('Short topic names covered, in English'),
  flashcards: z.array(
    z.object({
      topic: z.string(),
      front: z.string().describe('A question or cue that forces recall'),
      back: z.string().describe('Concise answer'),
    }),
  ),
  questions: z.array(
    z.object({
      topic: z.string(),
      question: z.string(),
      options: z.array(z.string()).describe('Exactly 4 options'),
      answer_index: z.number().int().describe('0-based index of the correct option'),
      explanation: z.string(),
    }),
  ),
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  // User-scoped client: RLS guarantees the student can only process their own lecture.
  const userDb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  // Service client: writes AI output tables (students only have read access to them).
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: auth } = await userDb.auth.getUser();
  const user = auth.user;
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { lecture_id } = await req.json().catch(() => ({}));
  if (!lecture_id) return json({ error: 'lecture_id required' }, 400);

  const { data: lecture } = await userDb.from('lectures').select('*, courses(code, title)').eq('id', lecture_id).maybeSingle();
  if (!lecture) return json({ error: 'not found' }, 404);

  // Free tier: 10 lectures / month. Re-processing the same lecture doesn't count again.
  const { data: allowed, error: quotaErr } = await userDb.rpc('consume_ai', { p_kind: 'lecture', p_ref: lecture_id });
  if (quotaErr) return json({ error: quotaErr.message, retryable: true }, 503);
  if (!allowed) return json({ error: 'quota' }, 402);

  const { data: profile } = await userDb.from('profiles').select('*').eq('id', user.id).maybeSingle();
  const { data: assets } = await userDb
    .from('assets')
    .select('*')
    .eq('lecture_id', lecture_id)
    .eq('deleted', false)
    .order('seq');

  try {
    await admin.from('lectures').update({ status: 'processing' }).eq('id', lecture_id);

    // ---------- 1. transcription (per segment, cached) ----------
    const audio = (assets ?? []).filter((a) => a.kind === 'audio');
    const { data: cached } = await admin.from('transcripts').select('asset_id, text').eq('lecture_id', lecture_id);
    const done = new Map((cached ?? []).map((t) => [t.asset_id, t.text as string]));
    const todo = audio.filter((a) => !done.has(a.id));
    await runLimited(todo, 3, async (a) => {
      const text = await transcribe(admin, a.storage_path, a.mime ?? 'audio/mp4');
      await admin.from('transcripts').upsert({ asset_id: a.id, user_id: user.id, lecture_id, text });
      done.set(a.id, text);
    });
    const transcript = audio.map((a, i) => `[Part ${i + 1}]\n${done.get(a.id) ?? ''}`).join('\n\n');

    // ---------- 2. slides & photos as Claude content blocks ----------
    const blocks: Anthropic.ContentBlockParam[] = [];
    const skipped: string[] = [];
    for (const a of (assets ?? []).filter((x) => x.kind !== 'audio')) {
      const mime: string = a.mime ?? '';
      const isPdf = mime === 'application/pdf' || a.storage_path.endsWith('.pdf');
      const isImage = mime.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(a.storage_path);
      if (!isPdf && !isImage) {
        skipped.push(a.name ?? a.storage_path); // e.g. .pptx — ask students to export PDF for now
        continue;
      }
      const b64 = await downloadBase64(admin, a.storage_path);
      if (isPdf) {
        blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }, title: a.name ?? 'Slides' });
      } else {
        const media = (mime.startsWith('image/') ? mime : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
        blocks.push({ type: 'image', source: { type: 'base64', media_type: media, data: b64 } });
      }
    }

    if (!transcript.trim() && blocks.length === 0 && !lecture.notes) {
      await admin.from('lectures').update({ status: 'captured' }).eq('id', lecture_id);
      return json({ error: 'nothing to process' }, 422);
    }

    // ---------- 3. Claude ----------
    const language = LANGUAGE_NAMES[profile?.language ?? 'en'] ?? 'English';
    const interests: string[] = profile?.analogies_enabled ? (profile?.interests ?? []) : [];

    if (lecture.kind === 'past_paper') {
      return json(await processPastPaper({ admin, lecture, userId: user.id, blocks, language, interests, notes: lecture.notes }));
    }

    const system = [
      'You turn a Nigerian university lecture into a study pack that helps a student remember it and pass exams.',
      `Write all student-facing text (summary, key points, emphasised items, flashcards, questions, explanations) in ${language}.`,
      'Keep technical terms, formulas, units and course-specific vocabulary in English, even when the surrounding text is in another language.',
      'Transcripts come from classroom audio: expect noise, code-switching between English and local languages, and mis-heard words. Use the slides and notes to correct obvious transcription errors; never invent content that is not supported by the material.',
      'Lecturers often signal exam content ("this will come out", "take note", repetition, writing on the board). Capture these in `emphasised`.',
      'Flashcards: 10-25, one idea each, front phrased as a question that requires recall, back short. Cover definitions, formulas, processes and the emphasised items.',
      'Questions: 5-10 multiple-choice, exactly 4 options, one correct, plausible distractors, explanation says why the answer is right.',
      interests.length
        ? `The student enjoys: ${interests.join(', ')}. Where it genuinely helps understanding, use an analogy from these interests in a flashcard back or explanation — at most a few, never forced.`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const text = [
      `Course: ${lecture.courses?.code} — ${lecture.courses?.title}`,
      `Date: ${lecture.date}${lecture.title ? `\nTopic given by student: ${lecture.title}` : ''}`,
      profile?.level ? `Student level: ${profile.level}` : '',
      lecture.notes ? `\nStudent's own notes:\n${lecture.notes}` : '',
      transcript.trim() ? `\nLecture transcript:\n${transcript}` : '\n(No audio recording for this lecture.)',
      blocks.length ? '\nThe attached documents/images are the slides and board photos from this lecture.' : '',
    ]
      .filter(Boolean)
      .join('\n');

    const claude = new Anthropic(); // reads ANTHROPIC_API_KEY
    const response = await claude.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(StudyPack) },
      system,
      messages: [{ role: 'user', content: [...blocks, { type: 'text', text }] }],
    });

    if (response.stop_reason === 'refusal') throw new Error(`refused: ${response.stop_details?.category ?? 'unknown'}`);
    if (response.stop_reason === 'max_tokens') throw new Error('output truncated');
    const pack = response.parsed_output;
    if (!pack) throw new Error('could not parse study pack');

    // ---------- 4. save (replace previous output for this lecture) ----------
    const courseId = lecture.course_id;
    await admin.from('cards').delete().eq('lecture_id', lecture_id);
    await admin.from('questions').delete().eq('lecture_id', lecture_id);
    await admin.from('lecture_ai').upsert({
      lecture_id,
      user_id: user.id,
      language: profile?.language ?? 'en',
      summary: pack.summary,
      key_points: pack.key_points,
      emphasised: pack.emphasised,
      topics: pack.topics,
      model: response.model,
      updated_at: new Date().toISOString(),
    });
    if (pack.flashcards.length)
      await admin.from('cards').insert(pack.flashcards.map((c) => ({ ...c, user_id: user.id, lecture_id, course_id: courseId })));
    const validQs = pack.questions.filter((q) => q.options.length === 4 && q.answer_index >= 0 && q.answer_index < 4);
    if (validQs.length)
      await admin.from('questions').insert(validQs.map((q) => ({ ...q, user_id: user.id, lecture_id, course_id: courseId })));
    await admin.from('lectures').update({ status: 'ready', updated_at: new Date().toISOString() }).eq('id', lecture_id);

    return json({ ok: true, cards: pack.flashcards.length, questions: validQs.length, skipped });
  } catch (e) {
    console.error('process-lecture failed', lecture_id, e);
    await admin.from('lectures').update({ status: 'failed' }).eq('id', lecture_id);
    const retryable = e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError;
    return json({ error: String((e as Error).message ?? e), retryable }, retryable ? 503 : 500);
  }
});

// ---------- past question papers ----------

const PastPaper = z.object({
  summary: z.string().describe('2-4 sentences: what this paper tests and how it is structured'),
  topic_frequency: z
    .array(z.object({ topic: z.string(), count: z.number().int() }))
    .describe('Topics in English with how many questions touch each, most frequent first'),
  questions: z.array(
    z.object({
      topic: z.string(),
      question: z.string().describe('The question as written on the paper (keep original wording, English)'),
      model_answer: z.string().describe('A concise, mark-scoring model answer or worked solution'),
    }),
  ),
});

async function processPastPaper(args: {
  admin: SupabaseClient;
  lecture: { id: string; course_id: string; date: string; title: string | null; courses?: { code: string; title: string } };
  userId: string;
  blocks: Anthropic.ContentBlockParam[];
  language: string;
  interests: string[];
  notes: string | null;
}) {
  const { admin, lecture, userId, blocks, language, interests } = args;
  if (!blocks.length) throw new Error('nothing to process');

  const system = [
    'You analyse past examination papers from a Nigerian university course so a student can prepare.',
    'Extract every question on the paper (including sub-questions as separate items when they stand alone). Keep question wording as printed, in English.',
    `Write model answers in ${language}, keeping technical terms, formulas and units in English. Answers should be what earns full marks: structured, concise, showing working for calculations.`,
    'Map each question to a short topic name in English, and count how often each topic appears.',
    'If part of the page is unreadable, skip that question rather than guessing.',
    interests.length ? `The student enjoys: ${interests.join(', ')}. You may use one of these for an analogy in an answer only where it truly aids understanding.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const text = [
    `Course: ${lecture.courses?.code} — ${lecture.courses?.title}`,
    lecture.title ? `Paper: ${lecture.title}` : '',
    args.notes ? `Student notes: ${args.notes}` : '',
    'The attached documents/images are the past question paper.',
  ]
    .filter(Boolean)
    .join('\n');

  const claude = new Anthropic();
  const response = await claude.messages.parse({
    model: MODEL,
    max_tokens: 32000,
    output_config: { effort: 'medium', format: zodOutputFormat(PastPaper) },
    system,
    messages: [{ role: 'user', content: [...blocks, { type: 'text', text }] }],
  });
  if (response.stop_reason === 'refusal') throw new Error(`refused: ${response.stop_details?.category ?? 'unknown'}`);
  if (response.stop_reason === 'max_tokens') throw new Error('output truncated');
  const paper = response.parsed_output;
  if (!paper) throw new Error('could not parse past paper');

  await admin.from('questions').delete().eq('lecture_id', lecture.id);
  await admin.from('cards').delete().eq('lecture_id', lecture.id);
  await admin.from('lecture_ai').upsert({
    lecture_id: lecture.id,
    user_id: userId,
    language,
    summary: paper.summary,
    key_points: paper.topic_frequency.map((t) => `${t.topic} (${t.count})`),
    emphasised: [],
    topics: paper.topic_frequency,
    model: response.model,
    updated_at: new Date().toISOString(),
  });
  if (paper.questions.length)
    await admin.from('questions').insert(
      paper.questions.map((q) => ({
        user_id: userId,
        lecture_id: lecture.id,
        course_id: lecture.course_id,
        topic: q.topic,
        question: q.question,
        options: [],
        answer_index: -1,
        explanation: q.model_answer,
        source: 'past',
      })),
    );
  await admin.from('lectures').update({ status: 'ready', updated_at: new Date().toISOString() }).eq('id', lecture.id);
  return { ok: true, questions: paper.questions.length };
}

// ---------- helpers ----------

async function downloadBase64(db: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`download failed: ${path}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Speech-to-text. Swap this function to change provider. */
async function transcribe(db: SupabaseClient, path: string, mime: string): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`download failed: ${path}`);
  const form = new FormData();
  form.append('file', new File([data], path.split('/').pop() ?? 'audio.m4a', { type: mime }));
  form.append('model', 'whisper-1');
  form.append('prompt', 'Nigerian university lecture. Speakers may mix English with Yoruba, Hausa, Igbo or Pidgin.');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
    body: form,
  });
  if (!res.ok) throw new Error(`transcription failed ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { text: string }).text;
}

async function runLimited<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}
