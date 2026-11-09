import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppConfig } from '@/services/queries/app-config';
import { FileText, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

// Dismissing the X is a snooze, not acceptance — only the checkbox + Accept
// button on /terms records consent (AppConfigService.accept_terms). Snoozed
// per the version it was dismissed for, so a further bump while someone's
// mid-snooze shows right away instead of waiting out the old snooze.
const DISMISS_KEY = 'terms_banner_dismissed';
const RESHOW_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export default function TermsUpdatedBanner() {
  const colorScheme = useColorScheme() ?? 'light';
  const t = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(t), [colorScheme]);
  const { data: config } = useAppConfig();
  const version = config?.terms.version;
  const [snoozed, setSnoozed] = useState(false);

  useEffect(() => {
    let live = true;
    SecureStore.getItemAsync(DISMISS_KEY)
      .then((v) => {
        if (!live || !v) return;
        const [atStr, verStr] = v.split(':');
        const sameVersion = Number(verStr) === version;
        const stillWithinWindow = Date.now() - Number(atStr) < RESHOW_AFTER_MS;
        setSnoozed(sameVersion && stillWithinWindow);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [version]);

  if (snoozed || !config?.terms.needs_review) return null;

  const dismiss = () => {
    setSnoozed(true);
    SecureStore.setItemAsync(DISMISS_KEY, `${Date.now()}:${version}`).catch(() => {});
  };

  return (
    <Animated.View entering={FadeInDown} exiting={FadeOutUp} style={styles.wrap}>
      <TouchableOpacity style={styles.body} activeOpacity={0.85} onPress={() => router.push('/terms' as any)}>
        <FileText size={18} color="#0369A1" />
        <ThemedText style={styles.text} numberOfLines={2}>
          Our Terms & Conditions have been updated. Tap to review.
        </ThemedText>
      </TouchableOpacity>
      <TouchableOpacity style={styles.closeBtn} onPress={dismiss} hitSlop={10}>
        <X size={16} color="#6B7280" />
      </TouchableOpacity>
    </Animated.View>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    wrap: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: '#F0F9FF', borderRadius: 14, borderWidth: 1, borderColor: '#BAE6FD',
      paddingVertical: 10, paddingHorizontal: 14, marginHorizontal: 16, marginBottom: 12,
    },
    body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    text: { flex: 1, fontFamily: Fonts.poppinsSemiBold, fontSize: 12.5, color: '#0C4A6E', lineHeight: 17 },
    closeBtn: { padding: 4 },
  });
}
