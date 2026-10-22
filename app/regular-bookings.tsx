import { useAppAlert } from '@/components/app-alert';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts } from '@/constants/theme';
import { padBottom, useBottomInset } from '@/hooks/use-bottom-inset';
import { Series, SkoFyApi } from '@/services/api';
import { router, useFocusEffect } from 'expo-router';
import { ChevronLeft, Repeat } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';

const CADENCE: Record<Series['cadence'], string> = { WEEKLY: 'Every week', BIWEEKLY: 'Every 2 weeks', MONTHLY: 'Every month' };
const STATUS: Record<Series['status'], string> = {
  PROPOSED: 'Waiting for the provider to accept', ACTIVE: 'On', PAUSED: 'Paused', ENDED: 'Ended', DECLINED: 'Declined',
};

// Repeat bookings (docs/MONEY_RULES_DESIGN.md §13): when the next visit is,
// and pause, resume or stop. Set one up from a finished job in Job history.
export default function RegularBookingsScreen() {
  const bottomInset = useBottomInset();
  const appAlert = useAppAlert();
  const [items, setItems] = useState<Series[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => { SkoFyApi.series.mine().then(setItems).catch(() => setItems([])); }, []);
  useFocusEffect(load);

  const change = async (id: string, action: 'PAUSE' | 'RESUME' | 'END') => {
    setBusy(id);
    try {
      await SkoFyApi.series.change(id, action);
      load();
    } catch (err: any) {
      appAlert.show('error', 'Not changed', err?.message ?? 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ThemedView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#111827" />
        </TouchableOpacity>
        <ThemedText style={s.headerTitle}>Regular bookings</ThemedText>
      </View>
      {!items ? <ActivityIndicator style={{ marginTop: 40 }} color="#111827" /> : (
        <ScrollView contentContainerStyle={padBottom([s.body, { paddingBottom: 24 }], bottomInset)}>
          {items.length === 0 && (
            <ThemedText style={s.muted}>
              None yet. Open Job history and tap “Book regularly” on a finished job to have the same provider come back on a
              schedule.
            </ThemedText>
          )}
          {items.map((it) => (
            <View key={it.id} style={s.card}>
              <View style={s.row}>
                <Repeat size={18} color="#111827" />
                <ThemedText style={s.cardTitle}>{it.title}</ThemedText>
              </View>
              <ThemedText style={s.item}>{it.provider_name ?? 'Your provider'} · {CADENCE[it.cadence]}</ThemedText>
              <ThemedText style={s.muted}>
                {STATUS[it.status]}
                {it.status === 'ACTIVE' ? ` · next visit ${new Date(it.next_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
              </ThemedText>
              {it.auto_accept_up_to != null && (
                <ThemedText style={s.muted}>Quotes up to ${it.auto_accept_up_to.toFixed(0)} are accepted and paid for you.</ThemedText>
              )}
              {busy === it.id ? <ActivityIndicator color="#111827" /> : (
                <View style={s.row}>
                  {it.status === 'ACTIVE' && (
                    <TouchableOpacity style={s.secondary} onPress={() => change(it.id, 'PAUSE')}>
                      <ThemedText style={s.secondaryText}>Pause</ThemedText>
                    </TouchableOpacity>
                  )}
                  {it.status === 'PAUSED' && (
                    <TouchableOpacity style={s.secondary} onPress={() => change(it.id, 'RESUME')}>
                      <ThemedText style={s.secondaryText}>Resume</ThemedText>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={s.secondary} onPress={() => change(it.id, 'END')}>
                    <ThemedText style={[s.secondaryText, { color: '#B91C1C' }]}>Stop</ThemedText>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
      {appAlert.element}
    </ThemedView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  headerTitle: { fontSize: 18, lineHeight: 24, fontFamily: Fonts.poppinsBold, color: '#111827' },
  body: { paddingHorizontal: 16, gap: 12 },
  card: { padding: 16, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: '#111827' },
  item: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppins, color: '#111827' },
  muted: { fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppins, color: '#6B7280' },
  secondary: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', backgroundColor: '#F3F4F6' },
  secondaryText: { fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
});
