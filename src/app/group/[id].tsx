import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Share as RNShare, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, Empty, Screen, T } from '@/components/ui';
import { Space, useColors } from '@/constants/theme';
import { formatBytes } from '@/db/lectures';
import {
  cachedGroup,
  cachedShares,
  downloadedMap,
  downloadShare,
  Group,
  inviteLink,
  leaveGroup,
  refreshGroups,
  removeShare,
  Share,
  shareSize,
} from '@/lib/groups';
import { groupErrorText } from '@/lib/group-errors';
import { useSync } from '@/state/sync';

export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const c = useColors();
  const { session } = useSync();
  const uid = session?.user.id;
  const [group, setGroup] = useState<Group | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [downloaded, setDownloaded] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setGroup(await cachedGroup(id));
    setShares(await cachedShares(id));
    setDownloaded(await downloadedMap());
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
      refreshGroups().then(load).catch(() => {});
    }, [load]),
  );

  if (!group) return <Screen><Stack.Screen options={{ title: '' }} /></Screen>;
  const isOwner = group.owner_id === uid;

  const invite = () => {
    const link = inviteLink(group.invite_code);
    RNShare.share({ message: t('groups.inviteMsg', { name: group.name, code: group.invite_code, link }) });
  };

  const download = async (s: Share) => {
    setBusyId(s.id);
    setError(null);
    try {
      const lectureId = await downloadShare(s);
      await load();
      router.push(`/lecture/${lectureId}`);
    } catch (e) {
      setError(groupErrorText(e, t));
    } finally {
      setBusyId(null);
    }
  };

  const unshare = (s: Share) =>
    Alert.alert(t('groups.unshare'), s.title ?? s.course_code, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('groups.unshare'),
        style: 'destructive',
        onPress: () => removeShare(s.id).then(load).catch((e) => setError(groupErrorText(e, t))),
      },
    ]);

  const leave = () =>
    Alert.alert(isOwner ? t('groups.close') : t('groups.leave'), isOwner ? t('groups.closeConfirm') : t('groups.leaveConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: isOwner ? t('groups.close') : t('groups.leave'),
        style: 'destructive',
        onPress: () => leaveGroup(id).then(() => router.back()).catch((e) => setError(groupErrorText(e, t))),
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: group.name }} />
      <Card style={{ gap: Space.sm }}>
        <T v="small">{t('groups.code')}</T>
        <T v="title" style={{ letterSpacing: 4 }} selectable>{group.invite_code}</T>
        <T v="small">{group.members.map((m) => m.display_name).join(', ')}</T>
        <Button label={t('groups.invite')} onPress={invite} />
      </Card>

      <Button kind="ghost" label={t('groups.shareLecture')} onPress={() => router.push({ pathname: '/group/share', params: { groupId: id } })} />
      {error && <T v="small" style={{ color: c.danger }}>{error}</T>}

      <T v="heading">{t('groups.shared')}</T>
      {shares.length === 0 && <Empty text={t('groups.noShares')} />}
      {shares.map((s) => {
        const local = downloaded[s.id];
        const mine = s.shared_by === uid;
        const size = shareSize(s);
        return (
          <Card key={s.id} style={{ gap: Space.sm }}>
            <View>
              <T v="body" style={{ fontWeight: '600' }}>{s.course_code} · {s.title ?? s.date}</T>
              <T v="small">
                {[t('groups.by', { name: s.sharer_name }), s.date, s.pack && t('groups.hasPack'),
                  s.files.length > 0 && `${t('groups.files', { count: s.files.length })} · ${formatBytes(size)}`]
                  .filter(Boolean).join(' · ')}
              </T>
            </View>
            {local ? (
              <Button kind="ghost" label={t('groups.open')} onPress={() => router.push(`/lecture/${local}`)} />
            ) : !mine ? (
              <Button
                label={busyId === s.id ? t('groups.downloading') : t('groups.download')}
                onPress={() => download(s)}
                disabled={busyId !== null}
              />
            ) : null}
            {(mine || isOwner) && <Button kind="danger" label={t('groups.unshare')} onPress={() => unshare(s)} />}
          </Card>
        );
      })}

      <Button kind="danger" label={isOwner ? t('groups.close') : t('groups.leave')} onPress={leave} style={{ marginTop: Space.lg }} />
    </Screen>
  );
}
