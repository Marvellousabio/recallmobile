import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { T } from '@/components/ui';
import { Radius, Space, useColors } from '@/constants/theme';
import { getCourse } from '@/db/repo';
import { ask, flushPending, listMessages, retry, TutorMessage } from '@/lib/tutor';
import { useSync } from '@/state/sync';

export default function Tutor() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const { session, lastSync } = useSync();
  const [code, setCode] = useState('');
  const [msgs, setMsgs] = useState<TutorMessage[]>([]);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const reload = useCallback(() => listMessages(courseId).then(setMsgs), [courseId]);

  const flush = useCallback(async () => {
    setThinking(true);
    const r = await flushPending(courseId);
    setThinking(false);
    setStatus(r === 'ok' ? null : r);
    reload();
  }, [courseId, reload]);

  useEffect(() => {
    getCourse(courseId).then((co) => setCode(co?.code ?? ''));
    reload();
  }, [courseId, reload]);

  // Retry queued questions whenever a sync succeeds (i.e. we're back online).
  useEffect(() => {
    if (msgs.some((m) => m.state === 'pending')) Promise.resolve().then(flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSync]);

  const send = async () => {
    const q = text.trim();
    if (!q) return;
    setText('');
    setThinking(true);
    const p = ask(courseId, q);
    setTimeout(reload, 50); // show the question immediately
    const r = await p;
    setThinking(false);
    setStatus(r === 'ok' ? null : r);
    reload();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: t('tutor.title', { code }) }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={{ padding: Space.md, gap: Space.sm }}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
          {msgs.length === 0 && (
            <View style={[styles.bubble, { backgroundColor: c.card, borderColor: c.border }]}>
              <T v="body">{t('tutor.intro', { code })}</T>
            </View>
          )}
          {msgs.map((m) => {
            const mine = m.role === 'user';
            return (
              <View key={m.id} style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                <View
                  style={[
                    styles.bubble,
                    mine ? { backgroundColor: c.primary, borderColor: c.primary } : { backgroundColor: c.card, borderColor: c.border },
                  ]}>
                  <T v="body" style={{ color: mine ? c.primaryText : c.text }} selectable>{m.content}</T>
                </View>
                {mine && m.state === 'pending' && <T v="small">{t('tutor.queued')}</T>}
                {mine && m.state === 'failed' && (
                  <Pressable onPress={async () => { await retry(m.id, courseId); reload(); }}>
                    <T v="small" style={{ color: c.danger }}>{t('tutor.failed')}</T>
                  </Pressable>
                )}
              </View>
            );
          })}
          {thinking && msgs.some((m) => m.state === 'pending') && <T v="small">{t('tutor.thinking')}</T>}
          {status === 'quota' && (
            <Pressable onPress={() => router.push('/premium')}>
              <T v="small" style={{ textAlign: 'center', color: c.danger }}>{t('premium.quotaTutor')} {t('premium.see')} →</T>
            </Pressable>
          )}
          {status === 'offline' && <T v="small" style={{ textAlign: 'center' }}>{t('tutor.offline')}</T>}
          {(status === 'signed-out' || !session) && <T v="small" style={{ textAlign: 'center' }}>{t('tutor.signIn')}</T>}
        </ScrollView>

        <View style={[styles.inputRow, { borderColor: c.border, backgroundColor: c.card }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('tutor.placeholder')}
            placeholderTextColor={c.muted}
            multiline
            style={[styles.input, { color: c.text }]}
          />
          <Pressable
            onPress={send}
            disabled={!text.trim()}
            style={[styles.send, { backgroundColor: c.primary, opacity: text.trim() ? 1 : 0.4 }]}
            accessibilityLabel={t('tutor.send')}>
            <T style={{ color: c.primaryText, fontWeight: '700' }}>↑</T>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '88%', borderWidth: 1, borderRadius: Radius.md, padding: Space.md },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm, padding: Space.sm, borderTopWidth: 1 },
  input: { flex: 1, minHeight: 44, maxHeight: 140, fontSize: 16, paddingHorizontal: Space.sm, paddingVertical: 10 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
