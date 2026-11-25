import { Fonts } from '@/constants/theme';
import { BACK_ONLINE_MS, useConnection } from '@/services/connection';
import { queryClient } from '@/services/query-client';
import { checkNow, useServerReachable } from '@/services/server-status';
import { CloudOff, Wifi, WifiOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';

// The app's one connection label — a small pill floating over the top of the
// screen, never a strip pushing or covering it: what's under and beside it
// stays tappable. Mounted once in app/_layout.tsx:
//  - "No internet connection": the phone is offline — everything on screen
//    stays usable; hidden while a screen shows its full-page
//    NoInternetState, so the two never appear together;
//  - "Can't reach Dodorez right now" + Retry: online, but the server isn't
//    answering (services/server-status.ts);
//  - "Back online": for a moment after either clears, while what's on screen
//    reloads.
// It replaced two banners that both showed when offline. The same file is in
// both apps: keep them identical.
const CONFIG = {
  offline: { bg: '#DC2626', icon: WifiOff, text: 'No internet connection' },
  server: { bg: '#0F172A', icon: CloudOff, text: 'Can’t reach Dodorez right now' },
  online: { bg: '#047857', icon: Wifi, text: 'Back online' },
};

export function NetworkStatusBanner() {
  const insets = useSafeAreaInsets();
  const { online, backOnline, fullPage } = useConnection();
  const reachable = useServerReachable();
  const [serverBack, setServerBack] = useState(false);
  const [checking, setChecking] = useState(false);

  // The server answering again: refresh what failed while it was away, and say so.
  const wasReachable = useRef(reachable);
  useEffect(() => {
    const cameBack = !wasReachable.current && reachable;
    wasReachable.current = reachable;
    if (!cameBack) return;
    void queryClient.invalidateQueries();
    setServerBack(true);
    const timer = setTimeout(() => setServerBack(false), BACK_ONLINE_MS);
    return () => clearTimeout(timer);
  }, [reachable]);

  // Just back: "Back online" for its moment, even while the server is being
  // checked; a server that's really down shows right after.
  const status = !online ? 'offline' : backOnline ? 'online' : !reachable ? 'server' : serverBack ? 'online' : null;
  if (!status || (status === 'offline' && fullPage)) return null;

  const retry = async () => {
    setChecking(true);
    try { await checkNow(); } finally { setChecking(false); }
  };

  const cfg = CONFIG[status];
  const Icon = cfg.icon;
  return (
    <View style={[styles.layer, { top: insets.top + 6 }]} pointerEvents="box-none">
    <Animated.View
      key={status}
      entering={FadeInUp.springify().damping(16)}
      exiting={FadeOutUp}
      pointerEvents={status === 'server' ? 'auto' : 'none'}
      style={[styles.pill, { backgroundColor: cfg.bg }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Icon size={17} color="#FFFFFF" strokeWidth={2.4} />
      <ThemedText style={styles.text} numberOfLines={1}>{cfg.text}</ThemedText>
      {status === 'server' && (
        <Pressable onPress={retry} disabled={checking} hitSlop={8} accessibilityRole="button" accessibilityLabel="Try again">
          {checking ? <ActivityIndicator size="small" color="#FFCE48" /> : <ThemedText style={styles.retry}>Retry</ThemedText>}
        </Pressable>
      )}
    </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 24,
    right: 24,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  pill: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  text: {
    flexShrink: 1,
    fontSize: 13.5, lineHeight: 19,
    fontFamily: Fonts.poppinsBold,
    color: '#FFFFFF',
  },
  retry: { fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppinsBold, color: '#FFCE48' },
});
