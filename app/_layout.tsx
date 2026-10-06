import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { useFonts } from 'expo-font';
import { Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
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
import { clearHomeCache } from '@/services/homeCache';
import { NetworkStatusBanner } from '@/components/network-status-banner';
import { ActiveJobStatusBanner } from '@/components/active-job-status-banner';
import AppLockGate from '@/components/app-lock-gate';
import SessionExpiredModal from '@/components/session-expired-modal';

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

  const [signedOutVisible, setSignedOutVisible] = useState(false);

  // Hiding this on fontsLoaded alone fires before the actual splash route
  // (app/index.tsx) has laid out and painted a frame — same latent gap fixed
  // on the provider app's splash (loading late / white flash / feels like it
  // skips straight past the animation). Hiding on the rendered tree's own
  // onLayout below waits for real content instead; this effect stays only as
  // a safety net for a font *load error*, where there may be nothing else to
  // layout-trigger the hide.
  useEffect(() => {
    if (error) {
      SplashScreen.hideAsync();
    }
  }, [error]);

  const handleRootLayout = () => {
    SplashScreen.hideAsync();
  };

  useEffect(() => {
    initCallManager();
    TokenStore.getAccessToken().then(token => {
      if (token) registerFcmToken();
    });
    setSessionExpiredHandler(() => {
      // The home-screen cache is keyed to the account that was logged in —
      // a session dying here (token revoked, or the account itself no
      // longer exists) means whatever's cached no longer has a confirmed
      // owner. Cleared outright rather than waiting for the next read's
      // userId check to discard it, so a login right after this doesn't
      // still have a stale file sitting there if something about that
      // check were ever wrong.
      clearHomeCache().catch(() => {});
      // A stale leftover token can 401 a background call (e.g. FCM
      // registration on launch) seconds after the user already landed on
      // /login themselves. Redirecting to /login again in that case still
      // triggers a fresh mount of the screen, silently wiping anything
      // they'd already typed (a half-entered phone number) — so skip the
      // redirect entirely when we're already there.
      if (pathnameRef.current !== '/login') {
        // Previously a silent, unexplained router.replace() — most jarring
        // when it fires because the user tapped a notification (a call
        // invite, a chat message) and got dumped onto the login screen
        // mid-transition with zero context, looking exactly like a crash.
        // This is the one place that redirect can originate from, so a
        // generic explanation here covers every trigger (a genuinely
        // expired session, or this account's refresh token having been
        // revoked by a newer login elsewhere for the same role).
        // A plain native Alert.alert() looked jarringly out of place next
        // to the rest of the app's branded modals — replaced with
        // SessionExpiredModal below. Navigation happens on its dismiss
        // callback, not immediately, so it doesn't fire while the message
        // is still on screen and the user hasn't actually seen it yet.
        setSignedOutVisible(true);
      }
    });
  }, []);

  if (!loaded && !error) {
    return null;
  }

  return (
    <View style={{ flex: 1 }} onLayout={handleRootLayout}>
      <KeyboardProvider>
        <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <AppProvider>
              <PostRequirementProvider>
                <AppLockGate>
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
                </AppLockGate>
                <SessionExpiredModal
                  visible={signedOutVisible}
                  onDismiss={() => {
                    setSignedOutVisible(false);
                    router.replace('/login' as any);
                  }}
                />
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
    </View>
  );
}

