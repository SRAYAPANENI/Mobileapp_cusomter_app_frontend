import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TextInput } from '@/components/scaled-text';
import { useAppAlert } from '@/components/app-alert';
import { Fonts } from '@/constants/theme';
import { padBottom, useBottomInset } from '@/hooks/use-bottom-inset';
import { SkoFyApi, StrikeView } from '@/services/api';
import { router, useFocusEffect } from 'expo-router';
import { ChevronLeft, Gift, ShieldCheck, ShieldAlert } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

const date = (iso: string) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

// Credits Dodorez gave when a provider let the customer down, and any strikes
// — a claim support found contradicted by evidence, or asking to pay outside
// the app — with why, when it expires, and an appeal to a senior member of
// the team (docs/MONEY_RULES_DESIGN.md §3, §5, §10).
export default function AccountStandingScreen() {
  const bottomInset = useBottomInset();
  const appAlert = useAppAlert();
  const [loading, setLoading] = useState(true);
  const [credit, setCredit] = useState(0);
  const [creditNotes, setCreditNotes] = useState<{ reason: string; remaining: number; created_at: string }[]>([]);
  const [strikes, setStrikes] = useState<StrikeView[]>([]);
  const [appealing, setAppealing] = useState<StrikeView | null>(null);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([SkoFyApi.payments.credits().catch(() => null), SkoFyApi.strikes.mine().catch(() => null)])
      .then(([c, s]) => {
        setCredit(c?.available ?? 0);
        setCreditNotes((c?.credits ?? []).filter((x) => x.remaining > 0));
        setStrikes(s?.strikes ?? []);
      })
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(load);

  const sendAppeal = async () => {
    if (!appealing) return;
    setSending(true);
    try {
      const result = await SkoFyApi.strikes.appeal(appealing.id, reason.trim());
      setAppealing(null);
      appAlert.show('success', 'Appeal sent', result.message);
      load();
    } catch (err: any) {
      appAlert.show('error', 'Could not send', err?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const active = strikes.filter((s) => s.active);

  return (
    <ThemedView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#111827" />
        </TouchableOpacity>
        <ThemedText style={s.headerTitle}>Credits & account</ThemedText>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#111827" />
      ) : (
        <ScrollView contentContainerStyle={padBottom([s.body, { paddingBottom: 24 }], bottomInset)}>
          <View style={s.card}>
            <View style={s.row}>
              <Gift size={18} color="#059669" />
              <ThemedText style={s.cardTitle}>Your credit: ${credit.toFixed(2)}</ThemedText>
            </View>
            <ThemedText style={s.muted}>
              {credit > 0
                ? 'It comes off your next payment automatically.'
                : "When a provider lets you down — doesn't show up, or arrives very late — we add a credit here."}
            </ThemedText>
            {creditNotes.map((c, i) => (
              <ThemedText key={i} style={s.item}>• ${c.remaining.toFixed(2)} — {c.reason}</ThemedText>
            ))}
          </View>

          <View style={s.card}>
            <View style={s.row}>
              {active.length ? <ShieldAlert size={18} color="#B45309" /> : <ShieldCheck size={18} color="#059669" />}
              <ThemedText style={s.cardTitle}>
                {active.length ? `${active.length} active strike${active.length > 1 ? 's' : ''}` : 'Your account is in good standing'}
              </ThemedText>
            </View>
            <ThemedText style={s.muted}>
              A strike is only given when our team reviews a claim and the evidence clearly contradicts it — never just
              for losing a dispute — or finds you asked to pay outside the app. Each one lasts 12 months, and you can
              appeal it.
            </ThemedText>
            {strikes.map((strike) => (
              <View key={strike.id} style={s.strike}>
                <ThemedText style={s.strikeDate}>
                  {date(strike.created_at)}
                  {strike.revoked_at ? ' · removed' : strike.active ? ` · until ${date(strike.expires_at)}` : ' · expired'}
                </ThemedText>
                <ThemedText style={s.item}>{strike.note}</ThemedText>
                {strike.revoked_at && strike.revoke_note && (
                  <ThemedText style={s.muted}>Removed on appeal: {strike.revoke_note}</ThemedText>
                )}
                {strike.appealed_at && !strike.revoked_at && (
                  <ThemedText style={s.muted}>Appeal sent {date(strike.appealed_at)} — a senior member of our team is reviewing it.</ThemedText>
                )}
                {strike.can_appeal && (
                  <TouchableOpacity onPress={() => { setReason(''); setAppealing(strike); }}>
                    <ThemedText style={s.link}>Appeal this decision</ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      <Modal visible={!!appealing} transparent animationType="fade" onRequestClose={() => setAppealing(null)}>
        <KeyboardAvoidingView behavior="padding" style={s.overlay}>
          <View style={s.sheet}>
            <ThemedText style={s.cardTitle}>Appeal this strike</ThemedText>
            <ThemedText style={s.muted}>Someone more senior, who wasn't part of the decision, will review it.</ThemedText>
            <TextInput
              style={s.input}
              placeholder="Why do you think the decision was wrong?"
              placeholderTextColor="#9CA3AF"
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={2000}
            />
            <View style={s.buttons}>
              <TouchableOpacity style={s.secondary} onPress={() => setAppealing(null)} disabled={sending}>
                <ThemedText style={s.secondaryText}>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.primary, (reason.trim().length < 20 || sending) && { opacity: 0.5 }]}
                onPress={sendAppeal}
                disabled={reason.trim().length < 20 || sending}
              >
                {sending ? <ActivityIndicator color="#111827" /> : <ThemedText style={s.primaryText}>Send appeal</ThemedText>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  card: { padding: 16, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: '#111827' },
  muted: { fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppins, color: '#6B7280' },
  item: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppins, color: '#111827' },
  strike: { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6', gap: 4 },
  strikeDate: { fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppinsSemiBold, color: '#92400E' },
  link: { marginTop: 4, fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#2563EB' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 10 },
  input: {
    minHeight: 100, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 10,
    fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppins, color: '#111827', textAlignVertical: 'top',
  },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  secondary: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#F3F4F6' },
  secondaryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  primary: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#FFCE48' },
  primaryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
});
