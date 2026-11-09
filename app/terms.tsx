import { useAppAlert } from '@/components/app-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';
import { padBottom, useBottomInset } from '@/hooks/use-bottom-inset';
import { useAppConfig } from '@/services/queries/app-config';
import { SkoFyApi } from '@/services/api';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/services/queries/keys';
import { router } from 'expo-router';
import { Check, ChevronLeft } from 'lucide-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';

// The admin portal's app_configs.terms_content for this app, dynamic — no
// app release needed to update it. Reached from the dashboard's "terms
// updated" banner, or any future "Terms & Conditions" settings link.
export default function TermsScreen() {
  const bottomInset = useBottomInset();
  const { data: config, isLoading } = useAppConfig();
  const queryClient = useQueryClient();
  const alert = useAppAlert();
  const [checked, setChecked] = useState(false);
  const [accepting, setAccepting] = useState(false);
  // needs_review is only ever present (true or false) for an authenticated
  // viewer of this app — see AppConfigService.public — so this both gates
  // the accept bar to logged-in people and skips it once already current.
  const needsReview = !!config?.terms.needs_review;

  const accept = async () => {
    if (!checked || accepting) return;
    setAccepting(true);
    try {
      // Only this — a deliberate checkbox + tap — ever records consent.
      // Opening the screen or dismissing the banner no longer does.
      await SkoFyApi.appConfig.acceptTerms();
      await queryClient.invalidateQueries({ queryKey: qk.appConfig });
      router.back();
    } catch (err: any) {
      alert.show('error', 'Could Not Save', err?.message ?? 'Please check your connection and try again.');
      setAccepting(false);
    }
  };

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
        <>
          <ScrollView style={s.scroll} contentContainerStyle={padBottom([s.body, { paddingBottom: 24 }], needsReview ? 0 : bottomInset)}>
            <ThemedText style={s.version}>Version {config.terms.version}</ThemedText>
            <ThemedText style={s.content}>{config.terms.content}</ThemedText>
          </ScrollView>
          {needsReview && (
            <View style={padBottom(s.acceptBar, bottomInset)}>
              <TouchableOpacity style={s.checkRow} activeOpacity={0.7} onPress={() => setChecked((c) => !c)}>
                <View style={[s.checkbox, checked && s.checkboxChecked]}>
                  {checked && <Check size={14} color="#fff" />}
                </View>
                <ThemedText style={s.checkLabel}>I have read and accept the Terms & Conditions</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.acceptBtn, (!checked || accepting) && s.acceptBtnDisabled]}
                disabled={!checked || accepting}
                onPress={accept}
              >
                {accepting ? <ActivityIndicator color="#fff" /> : <ThemedText style={s.acceptBtnText}>Accept</ThemedText>}
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </ThemedView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12 },
  back: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' },
  headerTitle: { fontSize: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 20 },
  version: { fontSize: 12, fontFamily: Fonts.poppinsSemiBold, color: '#9CA3AF', marginBottom: 12 },
  content: { fontSize: 14.5, lineHeight: 22, fontFamily: Fonts.poppins, color: '#374151' },
  acceptBar: {
    borderTopWidth: 1, borderTopColor: '#E5E7EB', backgroundColor: '#fff',
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16, gap: 14,
  },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#D1D5DB',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkboxChecked: { backgroundColor: '#111827', borderColor: '#111827' },
  checkLabel: { flex: 1, fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppins, color: '#374151' },
  acceptBtn: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827' },
  acceptBtnDisabled: { backgroundColor: '#D1D5DB' },
  acceptBtnText: { fontSize: 15, fontFamily: Fonts.poppinsSemiBold, color: '#fff' },
});
