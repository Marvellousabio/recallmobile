import { Tabs } from 'expo-router/tabs';
import { ColorValue, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useColors } from '@/constants/theme';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const { t } = useTranslation();
  const c = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
      }}>
      <Tabs.Screen name="index" options={{ title: t('tabs.today'), tabBarIcon: icon('◉') }} />
      <Tabs.Screen name="courses" options={{ title: t('tabs.courses'), tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="timetable" options={{ title: t('tabs.timetable'), tabBarIcon: icon('▦') }} />
      <Tabs.Screen name="progress" options={{ title: t('tabs.progress'), tabBarIcon: icon('▲') }} />
      <Tabs.Screen name="me" options={{ title: t('tabs.me'), tabBarIcon: icon('●') }} />
    </Tabs>
  );
}
