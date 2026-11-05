import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { queryClient } from '@/services/query-client';
import { checkNow, useServerReachable } from '@/services/server-status';
import { onlineManager } from '@tanstack/react-query';
import { CloudOff, WifiOff } from 'lucide-react-native';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Said on every screen, while it's true: the phone is offline, or the
// Dodorez server isn't answering (services/server-status.ts). Without it a
// dead connection looked like an empty account — signed in, nothing loading,
// nothing said. Small and centred at the top, so it never covers a screen's
// back button or its main action. When the server answers again everything
// on screen refreshes by itself.
export function ConnectionBanner() {
  const insets = useSafeAreaInsets();
  const reachable = useServerReachable();
  const online = useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
  const [checking, setChecking] = useState(false);

  // Back: refresh whatever failed while it was away.
  const wasReachable = useRef(reachable);
  useEffect(() => {
    if (!wasReachable.current && reachable) queryClient.invalidateQueries();
    wasReachable.current = reachable;
  }, [reachable]);

  if (online && reachable) return null;
  const retry = async () => {
    setChecking(true);
    try { await checkNow(); } finally { setChecking(false); }
  };

  return (
    <View pointerEvents="box-none" style={[s.wrap, { top: insets.top + 6 }]}>
      <View style={s.pill} accessibilityRole="alert" accessibilityLiveRegion="polite">
        {online ? <CloudOff size={15} color="#FFFFFF" /> : <WifiOff size={15} color="#FFFFFF" />}
        <ThemedText style={s.text} numberOfLines={1}>
          {online ? 'Can’t reach Dodorez right now' : 'You’re offline'}
        </ThemedText>
        {online && (
          <Pressable onPress={retry} disabled={checking} hitSlop={8} accessibilityRole="button" accessibilityLabel="Try again">
            {checking ? <ActivityIndicator size="small" color="#FFCE48" /> : <ThemedText style={s.retry}>Retry</ThemedText>}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 1000, elevation: 1000 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '86%',
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#0F172A',
    shadowColor: '#0F172A', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  text: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#FFFFFF' },
  retry: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsBold, color: '#FFCE48' },
});
