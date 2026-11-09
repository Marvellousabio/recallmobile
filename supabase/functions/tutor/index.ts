// Supabase Edge Function: course tutor.
// Answers a student's question grounded in that course's lectures, in their
// language, using analogies from their interests.
//
// Body: { course_id: string, messages: { role: 'user' | 'assistant', content: string }[] }

import Anthropic from 'npm:@anthropic-ai/sdk@1.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = Deno.env.get('CLAUDE_TUTOR_MODEL') ?? Deno.env.get('CLAUDE_MODEL') ?? 'claude-opus-5-5';
const MAX_TURNS = 20; // keep the last N messages of a chat; older context lives in the course material

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', pcm: 'Nigerian Pidgin', yo: 'Yoruba', ha: 'Hausa', ig: 'Igbo' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => null);
  const courseId: string | undefined = body?.course_id;
  const history: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(body?.messages) ? body.messages : [];
  if (!courseId || !history.length || history[history.length - 1].role !== 'user') {
    return json({ error: 'course_id and a trailing user message are required' }, 400);
  }

  // RLS scopes every read to this student.
  const [{ data: course }, { data: profile }, { data: lectures }, { data: packs }, { data: transcripts }] = await Promise.all([
    db.from('courses').select('code, title, lecturer').eq('id', courseId).maybeSingle(),
    db.from('profiles').select('language, interests, analogies_enabled, level').eq('id', auth.user.id).maybeSingle(),
    db.from('lectures').select('id, date, title, notes, kind').eq('course_id', courseId).eq('deleted', false).order('date'),
    db.from('lecture_ai').select('lecture_id, summary, key_points, emphasised'),
    db.from('transcripts').select('lecture_id, asset_id, text'),
  ]);
  if (!course) return json({ error: 'not found' }, 404);

  // Free tier: 30 tutor questions / month. The client sends a stable id per question so retries are free.
  const ref = typeof body?.message_id === 'string' ? body.message_id : crypto.randomUUID();
  const { data: allowed, error: quotaErr } = await db.rpc('consume_ai', { p_kind: 'tutor', p_ref: ref });
  if (quotaErr) return json({ error: quotaErr.message, retryable: true }, 503);
  if (!allowed) return json({ error: 'quota' }, 402);

  const packBy = new Map((packs ?? []).map((p) => [p.lecture_id, p]));
  const transcriptBy = new Map<string, string[]>();
  for (const t of transcripts ?? []) transcriptBy.set(t.lecture_id, [...(transcriptBy.get(t.lecture_id) ?? []), t.text]);

  const material = (lectures ?? [])
    .map((l) => {
      const p = packBy.get(l.id);
      const parts = [`## ${l.kind === 'past_paper' ? 'Past paper' : 'Lecture'} ${l.date}${l.title ? ` — ${l.title}` : ''}`];
      if (p) {
        parts.push(`Summary: ${p.summary}`);
        if (p.emphasised?.length) parts.push(`Lecturer stressed: ${p.emphasised.join('; ')}`);
        if (p.key_points?.length) parts.push(`Key points:\n- ${p.key_points.join('\n- ')}`);
      }
      if (l.notes) parts.push(`Student notes: ${l.notes}`);
      const tx = transcriptBy.get(l.id);
      if (tx?.length) parts.push(`Transcript:\n${tx.join('\n')}`);
      return parts.join('\n');
    })
    .join('\n\n');

  const language = LANGUAGE_NAMES[profile?.language ?? 'en'] ?? 'English';
  const interests: string[] = profile?.analogies_enabled ? (profile?.interests ?? []) : [];

  const instructions = [
    `You are a patient, encouraging tutor for ${course.code} (${course.title}) at a Nigerian university${profile?.level ? `, teaching a ${profile.level}-level student` : ''}.`,
    `Reply in ${language}. Keep technical terms, formulas and units in English.`,
    'Ground your answers in the course material below. When the material covers the question, teach it the way this lecturer did and say which lecture it came from. When it does not, you may teach from general knowledge but say clearly that it was not in the captured lectures.',
    'Teach for understanding and memory: explain simply, check understanding with a short question at the end when useful, and prefer making the student recall over just telling.',
    interests.length
      ? `The student enjoys ${interests.join(', ')}. When a concept is abstract, explain it with an analogy from one of these interests (for example football tactics for feedback systems), then connect it back to the precise technical idea.`
      : '',
    'Keep replies short enough to read on a phone: a few short paragraphs or a short list. Use plain text; avoid tables.',
  ]
    .filter(Boolean)
    .join('\n');

  const claude = new Anthropic();
  try {
    const response = await claude.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      system: [
        { type: 'text', text: instructions },
        // Course material is large and identical across a chat — cache it.
        { type: 'text', text: `# Course material\n\n${material || '(No lectures captured yet.)'}`, cache_control: { type: 'ephemeral' } },
      ],
      messages: history.slice(-MAX_TURNS).map((m) => ({ role: m.role, content: String(m.content) })),
    });

    if (response.stop_reason === 'refusal') return json({ error: 'refused' }, 422);
    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return json({ reply });
  } catch (e) {
    const retryable = e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError;
    console.error('tutor failed', e);
    return json({ error: String((e as Error).message ?? e), retryable }, retryable ? 503 : 500);
  }
});
