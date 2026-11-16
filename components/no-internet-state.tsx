import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { checkConnection, showingFullPage, useConnection } from '@/services/connection';
import { useIsFocused } from '@react-navigation/native';
import { WifiOff } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';

// Full page for a screen with nothing to show because there's no
// connection (opened offline, nothing loaded yet). A screen that already has
// content keeps it, and the top banner says it's offline instead — the two
// never show together: this tells services/connection.ts it's on screen and
// the banner hides. Its screen reloads itself when the connection returns
// (useReloadWhenBackOnline); Refresh checks again now. The same file is in
// both apps: keep them identical.
interface Props {
  onRetry: () => void;
  message?: string;
}

export function NoInternetState({ onRetry, message }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const t = Colors[colorScheme];
  const { online } = useConnection();
  const [checking, setChecking] = useState(false);

  // Only while its screen is in front: one left underneath (Home under
  // another screen, a tab not chosen) mustn't hide the banner there.
  const focused = useIsFocused();
  useEffect(() => (focused ? showingFullPage() : undefined), [focused]);

  const onRefresh = async () => {
    setChecking(true);
    try {
      const nowOnline = await checkConnection();
      // Coming back online: the screen's useReloadWhenBackOnline reloads it.
      // Online all along (a load that failed for another reason): reload now.
      if (nowOnline && online) onRetry();
    } finally {
      setChecking(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: t.inputFilled }]}>
        <WifiOff size={40} color="#EF4444" />
      </View>
      <ThemedText style={[styles.title, { color: t.textPrimary }]}>No internet connection</ThemedText>
      <ThemedText style={[styles.subtitle, { color: t.textSecondary }]}>
        {message || "Check your connection — this page reloads by itself when you're back online."}
      </ThemedText>
      <TouchableOpacity style={styles.retryBtn} onPress={onRefresh} activeOpacity={0.85} disabled={checking}>
        {checking ? <ActivityIndicator color="#111827" /> : <ThemedText style={styles.retryBtnText}>Refresh</ThemedText>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  iconWrap: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { fontSize: 19, lineHeight: 24, fontFamily: Fonts.poppinsBold, textAlign: 'center' },
  subtitle: { fontSize: 14, fontFamily: Fonts.poppins, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  retryBtn: { marginTop: 24, backgroundColor: '#FFCE48', borderRadius: 14, paddingHorizontal: 28, paddingVertical: 12, minWidth: 128, alignItems: 'center' },
  retryBtnText: { fontSize: 14, lineHeight: 18, fontFamily: Fonts.poppinsBold, color: '#111827' },
});
