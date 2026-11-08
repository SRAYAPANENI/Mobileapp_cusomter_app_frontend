import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';
import { padBottom, useBottomInset } from '@/hooks/use-bottom-inset';
import { useAppConfig } from '@/services/queries/app-config';
import { SkoFyApi } from '@/services/api';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, ScrollView, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';

// The admin portal's app_configs.terms_content for this app, dynamic — no
// app release needed to update it. Reached from the dashboard's "terms
// updated" banner, or any future "Terms & Conditions" settings link.
export default function TermsScreen() {
  const bottomInset = useBottomInset();
  const { data: config, isLoading } = useAppConfig();
  // Having actually opened and read this screen counts as reviewing the
  // update — marked once per visit, only when there was something to review,
  // so a stray navigation here before any update exists is a no-op.
  const markedRef = useRef(false);
  useEffect(() => {
    if (config?.terms.needs_review && !markedRef.current) {
      markedRef.current = true;
      SkoFyApi.appConfig.markTermsSeen().catch(() => {});
    }
  }, [config?.terms.needs_review]);

  return (
    <ThemedView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#111827" />
        </TouchableOpacity>
        <ThemedText style={s.headerTitle}>Terms & Conditions</ThemedText>
      </View>

      {isLoading || !config ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#111827" />
      ) : (
        <ScrollView contentContainerStyle={padBottom([s.body, { paddingBottom: 24 }], bottomInset)}>
          <ThemedText style={s.version}>Version {config.terms.version}</ThemedText>
          <ThemedText style={s.content}>{config.terms.content}</ThemedText>
        </ScrollView>
      )}
    </ThemedView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12 },
  back: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },
  headerTitle: { fontSize: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
  body: { paddingHorizontal: 20 },
  version: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: '#9CA3AF', marginBottom: 12 },
  content: { fontSize: 14.5, lineHeight: 22, fontFamily: Fonts.poppins, color: '#374151' },
});
