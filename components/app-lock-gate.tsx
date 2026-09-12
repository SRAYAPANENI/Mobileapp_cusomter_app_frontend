import AnimatedBrandMark from '@/components/animated-brand-mark';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AppLock } from '@/services/appLock';
import { isCallScreenActive, setCallActiveHandler } from '@/services/callManager';
import { Fingerprint } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, InteractionManager, StyleSheet, TouchableOpacity } from 'react-native';

// Re-lock after coming back from a REAL background stay, not a brief
// interruption — opening the camera/image picker, a share sheet, or a
// permission dialog all flip AppState to 'background'/'inactive' too, and
// re-prompting biometrics after every one of those would be unusable.
// PhonePe/WhatsApp-style apps use the same kind of grace window.
const BACKGROUND_GRACE_MS = 10000;

export default function AppLockGate({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);

  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);

  const appState = useRef<AppStateStatus>(AppState.currentState);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const isEnabled = await AppLock.isEnabled();
      setLocked(isEnabled);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    // A call answered while this gate is ALREADY showing the lock screen
    // (not just about to) needs to force it away immediately — the
    // AppState-driven check below only prevents a NEW lock, it can't undo
    // one already on screen. Without this, the user would be stuck staring
    // at "App Locked" with a connected call underneath it.
    setCallActiveHandler(() => setLocked(false));
    return () => setCallActiveHandler(null);
  }, []);

  useEffect(() => {
    // Reads AppLock.isEnabled() fresh on every transition rather than
    // capturing it once — the Settings toggle lives in a separate mounted
    // component (profile.tsx) with no way to reach this gate, so relying on
    // a snapshot taken at app launch meant flipping the toggle ON did
    // nothing until the app was force-quit and relaunched.
    const sub = AppState.addEventListener('change', async (next) => {
      const prev = appState.current;
      appState.current = next;
      const isEnabled = await AppLock.isEnabled();
      if (!isEnabled) {
        backgroundedAt.current = null;
        return;
      }
      if (prev === 'active' && next !== 'active') {
        backgroundedAt.current = Date.now();
      } else if (next === 'active' && prev !== 'active') {
        const awayMs = backgroundedAt.current ? Date.now() - backgroundedAt.current : Infinity;
        backgroundedAt.current = null;
        // A call/chat screen being open (or an incoming call in the process
        // of being answered — see isCallScreenActive's own comment) means
        // re-locking now would unmount that screen entirely rather than
        // just overlay it, silently ending the user's view of an active or
        // about-to-connect call.
        if (awayMs > BACKGROUND_GRACE_MS && !isCallScreenActive()) setLocked(true);
      }
    });
    return () => sub.remove();
  }, []);

  const tryUnlock = async () => {
    setAuthenticating(true);
    const success = await AppLock.authenticate('Unlock Dodorez');
    setAuthenticating(false);
    if (success) setLocked(false);
  };

  // Auto-prompt as soon as the lock screen appears, instead of making the
  // user tap "Unlock" first every single time. Firing it the instant
  // `locked` flips true means the native window hasn't actually regained
  // focus yet (right after cold start, or returning from background), and
  // Android's biometric prompt silently no-ops if shown before that, with
  // no error — it just looks like nothing happened until the user taps
  // "Unlock" manually a moment later, once the window is definitely
  // focused. runAfterInteractions alone isn't a reliable enough guard for
  // that — it only tracks legacy Animated-API interactions/JS-thread
  // idleness, nothing this screen registers, so it can resolve almost
  // instantly and land back in the same race. The extra fixed delay on top
  // is a deliberate buffer for native focus to actually settle.
  useEffect(() => {
    if (!locked) return;
    let timer: ReturnType<typeof setTimeout>;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        if (!authenticating) tryUnlock();
      }, 300);
    });
    return () => {
      task.cancel();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  if (!ready) return null;

  // Deliberately unmounts children (the Stack) entirely rather than
  // overlaying the lock screen on top of it — an overlay would leave any
  // currently-open native Modal (Settings, Add Skill, a rating sheet, etc.)
  // still visible, since RN Modals always render in their own top-level
  // native layer ABOVE regular views regardless of tree position or this
  // overlay's z-order. That would defeat the entire point of a lock screen.
  // The tradeoff — router.replace() having no mounted Stack to act on if a
  // background 401 fires while locked — is safe: TokenStore.clear() (see
  // api.ts) already ran before that handler is even invoked, so the
  // session is dead regardless of whether the navigate lands, and the Stack
  // re-resolves its own initial route (token-checked) fresh next time it
  // remounts anyway.
  if (locked) {
    return (
      <ThemedView style={styles.container}>
        <AnimatedBrandMark size={56} nameSize={32} />
        <ThemedText style={styles.title}>App Locked</ThemedText>
        <ThemedText style={styles.subtitle}>Unlock with your fingerprint or face to continue</ThemedText>
        <TouchableOpacity style={styles.unlockButton} onPress={tryUnlock} disabled={authenticating}>
          <Fingerprint size={22} color="#111827" />
          <ThemedText style={styles.unlockButtonText}>
            {authenticating ? 'Verifying…' : 'Unlock'}
          </ThemedText>
        </TouchableOpacity>
      </ThemedView>
    );
  }

  return <>{children}</>;
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    title: {
      fontFamily: Fonts.poppinsBold,
      fontSize: 22,
      color: t.textPrimary,
      marginTop: 28,
    },
    subtitle: {
      fontFamily: Fonts.poppins,
      fontSize: 14,
      color: t.textSecondary,
      textAlign: 'center',
      marginTop: 8,
    },
    unlockButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: '#FFCE48',
      paddingHorizontal: 24,
      paddingVertical: 14,
      borderRadius: 16,
      marginTop: 32,
    },
    unlockButtonText: {
      fontFamily: Fonts.poppinsSemiBold,
      fontSize: 15,
      color: '#111827',
    },
  });
}
