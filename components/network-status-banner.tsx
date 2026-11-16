import { Fonts } from '@/constants/theme';
import { BACK_ONLINE_MS, useConnection } from '@/services/connection';
import { queryClient } from '@/services/query-client';
import { checkNow, useServerReachable } from '@/services/server-status';
import { CloudOff, Wifi, WifiOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from './themed-text';

// The app's one connection banner, mounted once in app/_layout.tsx:
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
  offline: { bg: '#FEF2F2', color: '#EF4444', icon: WifiOff, text: 'No internet connection' },
  server: { bg: '#0F172A', color: '#FFFFFF', icon: CloudOff, text: 'Can’t reach Dodorez right now' },
  online: { bg: '#ECFDF5', color: '#10B981', icon: Wifi, text: 'Back online' },
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
    <Animated.View
      key={status}
      entering={FadeInDown}
      exiting={FadeOutUp}
      style={[styles.banner, { top: insets.top, backgroundColor: cfg.bg, borderBottomColor: cfg.color }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Icon size={15} color={cfg.color} />
      <ThemedText style={[styles.text, { color: cfg.color }]} numberOfLines={1}>{cfg.text}</ThemedText>
      {status === 'server' && (
        <Pressable onPress={retry} disabled={checking} hitSlop={8} accessibilityRole="button" accessibilityLabel="Try again">
          {checking ? <ActivityIndicator size="small" color="#FFCE48" /> : <ThemedText style={styles.retry}>Retry</ThemedText>}
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    zIndex: 9999,
    elevation: 9999,
  },
  text: {
    flexShrink: 1,
    fontSize: 13, lineHeight: 17,
    fontFamily: Fonts.poppinsBold,
  },
  retry: { fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppinsBold, color: '#FFCE48' },
});
