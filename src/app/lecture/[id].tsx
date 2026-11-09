import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Screen, T } from '@/components/ui';
import { Radius, Space, useColors } from '@/constants/theme';
import { getCourse } from '@/db/repo';
import {
  addAsset,
  Asset,
  deleteAsset,
  formatBytes,
  formatDuration,
  getLecture,
  Lecture,
  listAssets,
  queueProcessing,
  updateLecture,
} from '@/db/lectures';
import { countCards, getStudyPack, listQuestions, Question, saveRecallDump, StudyPack } from '@/db/study';
import { useLectureRecorder } from '@/hooks/use-lecture-recorder';
import { scheduleQuickRecall } from '@/lib/reminders';
import { ensureLocalFiles } from '@/lib/sync';
import { useSync } from '@/state/sync';

export default function LectureCapture() {
  const { id, recall } = useLocalSearchParams<{ id: string; recall?: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const { aiTick } = useSync();
  const [pack, setPack] = useState<StudyPack | null>(null);
  const [cardCount, setCardCount] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [dump, setDump] = useState('');
  const [dumpSaved, setDumpSaved] = useState(false);

  useEffect(() => {
    getStudyPack(id).then(setPack);
    countCards(id).then(setCardCount);
    listQuestions(id).then(setQuestions);
  }, [id, aiTick]);
  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [courseCode, setCourseCode] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const loaded = useRef(false);

  const reloadAssets = useCallback(() => {
    listAssets(id).then(setAssets);
  }, [id]);

  useEffect(() => {
    (async () => {
      const l = await getLecture(id);
      if (!l) return;
      setLecture(l);
      setTitle(l.title ?? '');
      setNotes(l.notes ?? '');
      setDump(l.recall_dump ?? '');
      const code = (await getCourse(l.course_id))?.code ?? '';
      setCourseCode(code);
      if (l.kind !== 'past_paper') scheduleQuickRecall(id, code).catch(() => {});
      reloadAssets();
      loaded.current = true;
      // Files recorded on another phone download when the lecture is opened.
      ensureLocalFiles(id).then((n) => n > 0 && reloadAssets()).catch(() => {});
    })();
  }, [id, reloadAssets]);

  // Autosave title + notes (debounced) — no save button to forget.
  useEffect(() => {
    if (!loaded.current) return;
    const h = setTimeout(() => updateLecture(id, { title: title.trim() || null, notes: notes.trim() || null }), 600);
    return () => clearTimeout(h);
  }, [id, title, notes]);

  const onSegmentSaved = useCallback(() => {
    reloadAssets();
    queueProcessing(id);
  }, [id, reloadAssets]);

  const rec = useLectureRecorder(id, onSegmentSaved);

  usePreventRemove(rec.phase === 'recording' || rec.phase === 'paused', () => {
    Alert.alert(t('lecture.recording'), t('lecture.stop') + '?', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('lecture.stop'), onPress: () => rec.stop() },
    ]);
  });

  // ---------- playback ----------
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const togglePlay = (a: Asset) => {
    if (playingId === a.id && status.playing) {
      player.pause();
      return;
    }
    if (playingId !== a.id) {
      player.replace({ uri: a.local_uri });
      setPlayingId(a.id);
    }
    player.play();
  };

  // ---------- slides & photos ----------
  const addFiles = async (kind: 'slide' | 'photo', items: { uri: string; name?: string | null; mimeType?: string | null }[]) => {
    for (const it of items) await addAsset(id, kind, it.uri, { name: it.name, mime: it.mimeType });
    reloadAssets();
    queueProcessing(id);
  };

  const pickSlides = async () => {
    const r = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'image/*'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (!r.canceled) addFiles('slide', r.assets);
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert(t('lecture.cameraDenied'));
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!r.canceled) addFiles('photo', r.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? 'board.jpg', mimeType: a.mimeType })));
  };

  const pickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.6 });
    if (!r.canceled) addFiles('photo', r.assets.map((a) => ({ uri: a.uri, name: a.fileName ?? 'photo.jpg', mimeType: a.mimeType })));
  };

  const confirmDelete = (a: Asset) =>
    Alert.alert(t('lecture.deleteAsset'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          if (playingId === a.id) player.pause();
          await deleteAsset(a);
          reloadAssets();
        },
      },
    ]);

  if (!lecture) return null;

  const audio = assets.filter((a) => a.kind === 'audio');
  const files = assets.filter((a) => a.kind !== 'audio');
  const live = rec.phase !== 'idle';
  const isPast = lecture.kind === 'past_paper';
  const dateLabel = new Date(`${lecture.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <Screen>
      <Stack.Screen options={{ title: courseCode }} />
      <T v="small">{dateLabel}</T>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder={t('lecture.titlePh')}
        placeholderTextColor={c.muted}
        style={[styles.titleInput, { color: c.text }]}
      />

      {/* Quick recall — free recall before re-reading is the strongest memory boost */}
      {!isPast && (recall === '1' || (!live && audio.length + files.length > 0)) && (
        <Card style={{ gap: Space.sm, borderColor: recall === '1' ? c.accent : c.border }}>
          <T v="heading">{t('recall.quickTitle')}</T>
          <T v="small">{t('recall.quickBody')}</T>
          <TextInput
            value={dump}
            onChangeText={(v) => { setDump(v); setDumpSaved(false); }}
            placeholder={t('recall.quickPh')}
            placeholderTextColor={c.muted}
            multiline
            textAlignVertical="top"
            style={[styles.notes, { minHeight: 110, color: c.text, borderColor: c.border, backgroundColor: c.bg }]}
          />
          <Button
            label={dumpSaved ? '✓' : t('common.save')}
            disabled={!dump.trim() || dumpSaved}
            onPress={async () => { await saveRecallDump(id, dump.trim()); setDumpSaved(true); }}
          />
        </Card>
      )}

      {/* AI study pack */}
      {isPast && pack ? (
        <Card style={{ gap: Space.sm }}>
          <T v="heading">{t('past.topics')}</T>
          <T v="body">{pack.summary}</T>
          {pack.key_points.map((k, i) => <T key={i} v="body">• {k}</T>)}
          {questions.length > 0 && (
            <Button
              label={t('past.practice', { count: questions.length })}
              onPress={() => router.push({ pathname: '/quiz', params: { lectureId: id } })}
              style={{ marginTop: Space.sm }}
            />
          )}
        </Card>
      ) : pack ? (
        <Card style={{ gap: Space.sm }}>
          <T v="heading">{t('ai.summary')}</T>
          <T v="body">{pack.summary}</T>
          {pack.emphasised.length > 0 && (
            <>
              <T v="heading" style={{ color: c.accent }}>{t('ai.emphasised')}</T>
              {pack.emphasised.map((e, i) => <T key={i} v="body">⚑ {e}</T>)}
            </>
          )}
          <T v="heading">{t('ai.keyPoints')}</T>
          {pack.key_points.map((k, i) => <T key={i} v="body">• {k}</T>)}
          {cardCount > 0 && (
            <Button
              label={t('ai.studyCards', { count: cardCount })}
              onPress={() => router.push({ pathname: '/review', params: { lectureId: id } })}
              style={{ marginTop: Space.sm }}
            />
          )}
          {questions.length > 0 && (
            <Button
              kind="ghost"
              label={t('ai.questionsReady', { count: questions.length })}
              onPress={() => router.push({ pathname: '/quiz', params: { lectureId: id } })}
            />
          )}
        </Card>
      ) : lecture.status === 'processing' ? (
        <Card><T v="muted">{t('ai.processing')}</T></Card>
      ) : lecture.status === 'quota' ? (
        <Card style={{ gap: Space.sm }}>
          <T v="muted">{t('premium.quotaLecture')}</T>
          <Button label={t('premium.see')} onPress={() => router.push('/premium')} />
        </Card>
      ) : lecture.status === 'failed' ? (
        <Card><T v="muted" style={{ color: c.danger }}>{t('ai.failed')}</T></Card>
      ) : null}

      {isPast && <T v="muted">{t('past.howTo')}</T>}

      {/* Recorder */}
      {!isPast && (
      <Card style={{ alignItems: 'center', gap: Space.md, paddingVertical: Space.lg }}>
        <View style={[styles.recDot, { backgroundColor: rec.phase === 'recording' ? c.danger : c.border }]} />
        <T v="title" style={{ fontVariant: ['tabular-nums'] }}>{formatDuration(rec.elapsedMs)}</T>
        <T v="small">
          {rec.phase === 'recording' ? t('lecture.recording') : rec.phase === 'paused' ? t('lecture.paused') : rec.phase === 'saving' ? t('lecture.saving') : t('lecture.recordHint')}
        </T>
        {rec.error === 'permission' && <T v="small" style={{ color: c.danger, textAlign: 'center' }}>{t('lecture.micDenied')}</T>}
        {rec.error === 'segment' && <T v="small" style={{ color: c.danger, textAlign: 'center' }}>{t('lecture.segmentError')}</T>}
        {!live ? (
          <Button label={t('lecture.record')} onPress={rec.start} style={{ alignSelf: 'stretch' }} />
        ) : (
          <View style={{ flexDirection: 'row', gap: Space.sm, alignSelf: 'stretch' }}>
            <Button
              kind="ghost"
              label={rec.phase === 'paused' ? t('lecture.resume') : t('lecture.pause')}
              onPress={rec.phase === 'paused' ? rec.resume : rec.pause}
              disabled={rec.phase === 'saving'}
              style={{ flex: 1 }}
            />
            <Button label={t('lecture.stop')} onPress={rec.stop} disabled={rec.phase === 'saving'} style={{ flex: 1 }} />
          </View>
        )}
      </Card>
      )}

      {audio.length > 0 && (
        <>
          <T v="heading">{t('lecture.recordings')}</T>
          {audio.map((a, i) => {
            const isCur = playingId === a.id;
            return (
              <Card key={a.id} onPress={() => togglePlay(a)} style={styles.row}>
                <View style={[styles.playBtn, { backgroundColor: c.primary }]}>
                  <T style={{ color: c.primaryText, fontSize: 14 }}>{isCur && status.playing ? '❚❚' : '▶'}</T>
                </View>
                <View style={{ flex: 1 }}>
                  <T v="body">{t('lecture.part', { n: i + 1 })}</T>
                  <T v="small">
                    {isCur && status.duration ? `${formatDuration(status.currentTime * 1000)} / ` : ''}
                    {formatDuration(a.duration_ms ?? 0)} · {formatBytes(a.size_bytes)}
                  </T>
                </View>
                <Pressable hitSlop={12} onPress={() => confirmDelete(a)}>
                  <T v="small">✕</T>
                </Pressable>
              </Card>
            );
          })}
        </>
      )}

      {/* Slides & photos */}
      <T v="heading">{t('lecture.slides')}</T>
      <View style={styles.thumbs}>
        {files.map((a) => (
          <Pressable key={a.id} onLongPress={() => confirmDelete(a)} onPress={() => confirmDelete(a)}>
            {a.kind === 'photo' || a.mime?.startsWith('image/') ? (
              <Image source={{ uri: a.local_uri }} style={[styles.thumb, { borderColor: c.border }]} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.docThumb, { borderColor: c.border, backgroundColor: c.card }]}>
                <T v="heading" style={{ color: c.accent }}>{(a.name?.split('.').pop() ?? 'DOC').toUpperCase()}</T>
                <T v="small" numberOfLines={2} style={{ textAlign: 'center' }}>{a.name}</T>
              </View>
            )}
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: Space.sm }}>
        <Button kind="ghost" label={t('lecture.takePhoto')} onPress={takePhoto} style={{ flex: 1, paddingHorizontal: Space.sm }} />
        <Button kind="ghost" label={t('lecture.pickPhoto')} onPress={pickPhoto} style={{ flex: 1, paddingHorizontal: Space.sm }} />
      </View>
      <Button kind="ghost" label={t('lecture.addSlides')} onPress={pickSlides} />

      {/* Notes */}
      <T v="heading">{t('lecture.notes')}</T>
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder={t('lecture.notesPh')}
        placeholderTextColor={c.muted}
        multiline
        textAlignVertical="top"
        style={[styles.notes, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
      />

      {assets.length > 0 && <T v="small" style={{ textAlign: 'center' }}>✓ {t('lecture.saved')} · {t('lecture.queued')}</T>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleInput: { fontSize: 22, fontWeight: '600', paddingVertical: Space.xs },
  recDot: { width: 14, height: 14, borderRadius: 7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  playBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  thumb: { width: 96, height: 96, borderRadius: Radius.sm, borderWidth: 1 },
  docThumb: { alignItems: 'center', justifyContent: 'center', padding: Space.xs, gap: 2 },
  notes: { minHeight: 140, borderWidth: 1, borderRadius: Radius.sm, padding: Space.md, fontSize: 16 },
});
