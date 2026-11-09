import { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Radius, Space, useColors } from '@/constants/theme';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const c = useColors();
  const body = scroll ? (
    <ScrollView contentContainerStyle={styles.screenPad} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screenPad, { flex: 1 }]}>{children}</View>
  );
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top']}>{body}</SafeAreaView>;
}

type TVariant = 'title' | 'heading' | 'body' | 'muted' | 'small';
export function T({ v = 'body', style, ...p }: TextProps & { v?: TVariant }) {
  const c = useColors();
  const base = {
    title: { fontSize: 28, fontWeight: '700' as const, color: c.text, lineHeight: 34 },
    heading: { fontSize: 18, fontWeight: '600' as const, color: c.text },
    body: { fontSize: 16, color: c.text, lineHeight: 22 },
    muted: { fontSize: 15, color: c.muted, lineHeight: 21 },
    small: { fontSize: 13, color: c.muted },
  }[v];
  return <Text {...p} style={[base, style]} />;
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const c = useColors();
  const bg = kind === 'primary' ? c.primary : 'transparent';
  const fg = kind === 'primary' ? c.primaryText : kind === 'danger' ? c.danger : c.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        kind !== 'primary' && { borderWidth: 1, borderColor: c.border },
        style,
      ]}>
      <Text style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...p }: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={{ gap: Space.xs, marginBottom: Space.md }}>
      <T v="small">{label}</T>
      <TextInput
        placeholderTextColor={c.muted}
        {...p}
        style={[styles.input, { borderColor: c.border, color: c.text, backgroundColor: c.card }, p.style]}
      />
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const c = useColors();
  const s = [styles.card, { backgroundColor: c.card, borderColor: c.border }, style];
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [...s, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  ) : (
    <View style={s}>{children}</View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!selected }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? c.primary : c.chip }]}>
      <Text style={{ color: selected ? c.primaryText : c.text, fontSize: 15, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

export function Empty({ text }: { text: string }) {
  const c = useColors();
  return (
    <View style={[styles.empty, { borderColor: c.border }]}>
      <T v="muted" style={{ textAlign: 'center' }}>{text}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  screenPad: { padding: Space.md, paddingBottom: Space.xl * 2, gap: Space.md },
  btn: { minHeight: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.lg },
  input: { minHeight: 50, borderWidth: 1, borderRadius: Radius.sm, paddingHorizontal: Space.md, fontSize: 16 },
  card: { borderWidth: 1, borderRadius: Radius.md, padding: Space.md, gap: Space.xs },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.pill },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: Radius.md, padding: Space.lg },
});
