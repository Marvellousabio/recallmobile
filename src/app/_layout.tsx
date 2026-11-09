import '@/i18n';

import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Href, router, Stack, ThemeProvider } from 'expo-router';

import { initReminders } from '@/lib/reminders';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppProvider, useApp } from '@/state/app';
import { SyncProvider } from '@/state/sync';

SplashScreen.preventAutoHideAsync();

function RootNav() {
  const { ready, profile } = useApp();
  const { t } = useTranslation();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  const onboarded0 = !!profile?.onboarded;
  useEffect(() => {
    if (!onboarded0) return;
    initReminders().catch(() => {});
    // Tapping a reminder opens the screen it points to.
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const url = r.notification.request.content.data?.url;
      if (typeof url === 'string') router.push(url as Href);
    });
    return () => sub.remove();
  }, [onboarded0]);

  if (!ready) return null;
  const onboarded = !!profile?.onboarded;

  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Protected guard={!onboarded}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={onboarded}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="course/new" options={{ title: t('courses.add'), presentation: 'modal' }} />
        <Stack.Screen name="course/[id]" options={{ title: '' }} />
        <Stack.Screen name="lecture/[id]" options={{ title: '' }} />
        <Stack.Screen name="account" options={{ title: '', presentation: 'modal' }} />
        <Stack.Screen name="review" options={{ title: t('recall.title') }} />
        <Stack.Screen name="quiz" options={{ title: t('quiz.title') }} />
        <Stack.Screen name="exam/new" options={{ title: t('exam.add'), presentation: 'modal' }} />
        <Stack.Screen name="exam/[id]" options={{ title: '' }} />
        <Stack.Screen name="tutor/[courseId]" options={{ title: '' }} />
        <Stack.Screen name="premium" options={{ title: '', presentation: 'modal' }} />
        <Stack.Screen name="slot/new" options={{ title: t('courses.addClass'), presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AppProvider>
        <SyncProvider>
          <RootNav />
        </SyncProvider>
      </AppProvider>
    </ThemeProvider>
  );
}
