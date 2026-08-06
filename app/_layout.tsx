import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOfflineQueueStore } from '@/store/offlineQueueStore';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Started once, for the app's whole lifetime, regardless of which screen
  // is on top - not inside the chat screen - so a message queued while the
  // user is elsewhere still flushes the moment connectivity returns.
  useEffect(() => useOfflineQueueStore.getState().init(), []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
