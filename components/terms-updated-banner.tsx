import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppConfig } from '@/services/queries/app-config';
import { SkoFyApi } from '@/services/api';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/services/queries/keys';
import { FileText, X } from 'lucide-react-native';
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

// Dismissible, not blocking — the admin portal bumped app_configs.terms_version
// since this person last dismissed it (terms.needs_review, which only comes
// back true once logged in — see app/domain/app_config.py's needs_terms_review).
export default function TermsUpdatedBanner() {
  const colorScheme = useColorScheme() ?? 'light';
  const t = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(t), [colorScheme]);
  const { data: config } = useAppConfig();
  const queryClient = useQueryClient();
  // Locally hidden the instant it's tapped, so the dismiss feels instant —
  // the server call confirms it in the background; a failure just means the
  // banner comes back next launch, not stuck forever either way.
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !config?.terms.needs_review) return null;

  const dismiss = () => {
    setDismissed(true);
    SkoFyApi.appConfig.markTermsSeen()
      .then(() => queryClient.invalidateQueries({ queryKey: qk.appConfig }))
      .catch(() => {});
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
