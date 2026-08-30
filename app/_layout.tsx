import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { useFonts } from 'expo-font';
import { Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import 'react-native-reanimated';

import {
  Poppins_400Regular,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';

import { useColorScheme } from '@/hooks/use-color-scheme';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: '(tabs)',
};

import { AppProvider } from '@/context/AppContext';
import { PostRequirementProvider } from '@/context/PostRequirementContext';
import { initCallManager, registerFcmToken } from '@/services/callManager';
import { STRIPE_PUBLISHABLE_KEY, TokenStore, setSessionExpiredHandler } from '@/services/api';
import { NetworkStatusBanner } from '@/components/network-status-banner';
import { ActiveJobStatusBanner } from '@/components/active-job-status-banner';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded, error] = useFonts({
    'Poppins-Regular': Poppins_400Regular,
    'Poppins-SemiBold': Poppins_600SemiBold,
    'Poppins-Bold': Poppins_700Bold,
  });

  // Tracked via ref (not read directly in the effect below) so the
  // session-expired handler — registered once on mount — always sees the
  // *current* route rather than closing over whatever it was at register time.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    initCallManager();
    TokenStore.getAccessToken().then(token => {
      if (token) registerFcmToken();
    });
    setSessionExpiredHandler(() => {
      // A stale leftover token can 401 a background call (e.g. FCM
      // registration on launch) seconds after the user already landed on
      // /login themselves. Redirecting to /login again in that case still
      // triggers a fresh mount of the screen, silently wiping anything
      // they'd already typed (a half-entered phone number) — so skip the
      // redirect entirely when we're already there.
      if (pathnameRef.current !== '/login') {
        router.replace('/login' as any);
      }
    });
  }, []);

  if (!loaded && !error) {
    return null;
  }

  return (
    <KeyboardProvider>
      <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AppProvider>
            <PostRequirementProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="index" />
                <Stack.Screen name="login" options={{ animation: 'fade' }} />
                <Stack.Screen name="register" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="forgot-password" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="(tabs)" options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
              </Stack>
              <NetworkStatusBanner />
              <ActiveJobStatusBanner />
              {/* "auto" follows the device's actual system theme, not our
                  locked-light useColorScheme — on a dark-mode device that would
                  pick light (white) icons over this app's light backgrounds and
                  make them invisible. Pinned to dark icons to match. */}
              <StatusBar style="dark" />
            </PostRequirementProvider>
          </AppProvider>
        </ThemeProvider>
      </StripeProvider>
    </KeyboardProvider>
  );
}

