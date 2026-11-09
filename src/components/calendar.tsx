import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { T } from '@/components/ui';
import { Radius, Space, useColors } from '@/constants/theme';
import { todayISO } from '@/db/lectures';

/** Month grid date picker. Only today and later can be picked. */
export function Calendar({ value, onChange }: { value: string | null; onChange: (iso: string) => void }) {
  const { t } = useTranslation();
  const c = useColors();
  const today = todayISO();
  const [cursor, setCursor] = useState(() => {
    const d = value ? new Date(`${value}T00:00:00`) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const short = t('daysShort', { returnObjects: true }) as string[];
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday first
  const daysIn = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const iso = (d: number) => todayISO(new Date(year, month, d));
  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const canPrev = new Date(year, month, 1) > new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  return (
    <View style={[styles.wrap, { borderColor: c.border, backgroundColor: c.card }]}>
      <View style={styles.header}>
        <Pressable hitSlop={12} disabled={!canPrev} onPress={() => setCursor(new Date(year, month - 1, 1))} style={{ opacity: canPrev ? 1 : 0.3 }}>
          <T v="heading">‹</T>
        </Pressable>
        <T v="heading">{monthLabel}</T>
        <Pressable hitSlop={12} onPress={() => setCursor(new Date(year, month + 1, 1))}>
          <T v="heading">›</T>
        </Pressable>
      </View>
      <View style={styles.row}>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
          <T key={d} v="small" style={styles.cellText}>{short[d]}</T>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, w) => (
        <View key={w} style={styles.row}>
          {cells.slice(w * 7, w * 7 + 7).map((d, k) => {
            if (!d) return <View key={k} style={styles.cell} />;
            const day = iso(d);
            const past = day < today;
            const sel = day === value;
            return (
              <Pressable
                key={k}
                disabled={past}
                onPress={() => onChange(day)}
                style={[styles.cell, sel && { backgroundColor: c.primary, borderRadius: Radius.pill }]}>
                <T v="body" style={[styles.cellText, { color: sel ? c.primaryText : past ? c.border : c.text, fontWeight: day === today ? '700' : '400' }]}>
                  {d}
                </T>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderWidth: 1, borderRadius: Radius.md, padding: Space.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Space.sm, paddingVertical: Space.sm },
  row: { flexDirection: 'row' },
  cell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  cellText: { flex: 1, textAlign: 'center' },
});
