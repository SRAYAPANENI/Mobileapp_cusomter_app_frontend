import { NoInternetState } from '@/components/no-internet-state';
import { ThemedView } from '@/components/themed-view';
import { useConnection, useReloadWhenBackOnline } from '@/services/connection';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import React, { useRef } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The one rule for every screen that loads its own data (services/connection.ts):
//  - offline with nothing to show: the full page (the banner hides);
//  - content already shown: it stays, with the banner over it;
//  - back online: what hadn't loaded reloads by itself.
// A hook, not a wrapper, so it lives in the screen and keeps running when
// the screen swaps the full page for its content. The same file is in both
// apps: keep them identical.

/** True when the screen should show the full offline page. Reloads, once
 * back online, a screen that had nothing to show — never one that did (it
 * isn't swapped under someone reading or editing it). */
export function useOfflinePage(hasData: boolean, onRetry: () => void): boolean {
  const { online } = useConnection();
  const latest = useRef({ hasData, onRetry });
  latest.current = { hasData, onRetry };
  useReloadWhenBackOnline(() => { if (!latest.current.hasData) latest.current.onRetry(); });
  return !online && !hasData;
}

/** The full offline page as a whole screen, with a way back — for a screen
 * that has no header of its own until its data loads. */
export function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <ThemedView style={styles.screen}>
      {router.canGoBack() && (
        <TouchableOpacity
          style={[styles.back, { top: insets.top + 8 }]}
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityLabel="Back"
        >
          <ChevronLeft size={24} color="#111827" />
        </TouchableOpacity>
      )}
      <NoInternetState onRetry={onRetry} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { position: 'absolute', left: 16, zIndex: 2, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },
});
