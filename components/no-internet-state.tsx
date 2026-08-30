import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { WifiOff } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

// Full-page takeover for "nothing to show because there's no connection" —
// distinct from network-status-banner.tsx's small top toast, which handles
// the "you're mid-session and briefly dropped offline, but already have
// content on screen" case. This is only for screens with genuinely nothing
// loaded yet, matching how apps like LinkedIn only show a full-page state on
// a fresh load with no cached data.
interface Props {
  onRetry: () => void;
  message?: string;
}

export function NoInternetState({ onRetry, message }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const t = Colors[colorScheme];

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: t.inputFilled }]}>
        <WifiOff size={40} color="#EF4444" />
      </View>
      <ThemedText style={[styles.title, { color: t.textPrimary }]}>No internet connection</ThemedText>
      <ThemedText style={[styles.subtitle, { color: t.textSecondary }]}>
        {message || 'Check your connection, then try again.'}
      </ThemedText>
      <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.85}>
        <ThemedText style={styles.retryBtnText}>Refresh</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  iconWrap: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { fontSize: 19, fontFamily: Fonts.poppinsBold, textAlign: 'center' },
  subtitle: { fontSize: 14, fontFamily: Fonts.poppins, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  retryBtn: { marginTop: 24, backgroundColor: '#FFCE48', borderRadius: 14, paddingHorizontal: 28, paddingVertical: 12 },
  retryBtnText: { fontSize: 14, fontFamily: Fonts.poppinsBold, color: '#111827' },
});
