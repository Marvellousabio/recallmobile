import { StyleSheet, View } from 'react-native';

import { Card, T } from '@/components/ui';
import { Space } from '@/constants/theme';
import { formatTime, SlotWithCourse } from '@/db/repo';

export function SlotRow({ s, onPress, onLongPress }: { s: SlotWithCourse; onPress?: () => void; onLongPress?: () => void }) {
  return (
    <Card onPress={onPress} style={styles.row}>
      <View style={[styles.bar, { backgroundColor: s.color }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="heading">{s.code}</T>
        <T v="muted" numberOfLines={1}>{s.title}</T>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <T v="body">{formatTime(s.start_min)}</T>
        <T v="small">{s.venue ?? formatTime(s.end_min)}</T>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
});
