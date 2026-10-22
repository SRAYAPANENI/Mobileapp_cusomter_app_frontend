import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useHirePayment } from '@/hooks/use-hire-payment';
import { ExtraWork, SkoFyApi } from '@/services/api';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';

// How often a running job checks for a new request (a push also brings the
// customer here).
const POLL_MS = 15000;

interface Props {
  jobId: string;
  onMessage: (kind: 'success' | 'error' | 'info', title: string, message: string) => void;
}

// Work the provider asks to add once the job has started
// (docs/MONEY_RULES_DESIGN.md §11): approve and pay it into escrow before
// it's done, or turn it down and the job goes on as agreed.
export function ExtraWorkCard({ jobId, onMessage }: Props) {
  const { payExtraWork } = useHirePayment();
  const [work, setWork] = useState<ExtraWork | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    SkoFyApi.jobs.extraWork(jobId).then(setWork).catch(() => setWork(null));
  }, [jobId]);
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!work || (work.status !== 'PROPOSED' && work.status !== 'ACCEPTED' && work.status !== 'PAID')) return null;

  const approve = async () => {
    setBusy(true);
    const result = await payExtraWork(jobId);
    setBusy(false);
    if (result.status === 'success') onMessage('success', 'Paid', "It's held safely until the job is done — your provider can go ahead.");
    else if (result.status === 'pending') onMessage('info', 'Processing', result.message);
    else if (result.status === 'error') onMessage('error', 'Payment failed', result.message);
    load();
  };

  const decline = async () => {
    setBusy(true);
    try {
      await SkoFyApi.jobs.declineExtraWork(jobId);
      onMessage('info', 'Turned down', 'The job goes on as agreed.');
    } catch (err: any) {
      onMessage('error', 'Something went wrong', err?.message ?? 'Please try again.');
    } finally {
      setBusy(false);
      load();
    }
  };

  return (
    <View style={s.card}>
      <ThemedText style={s.title}>{work.status === 'PAID' ? 'Added work — paid' : 'Your provider asks to add work'}</ThemedText>
      <ThemedText style={s.amount}>${work.amount.toFixed(2)}</ThemedText>
      <ThemedText style={s.body}>{work.description}</ThemedText>
      {work.status === 'PAID' ? (
        <ThemedText style={s.muted}>Held safely and paid to your provider with the rest of the job.</ThemedText>
      ) : (
        <>
          <ThemedText style={s.muted}>
            You pay it now into escrow, before the work is done — like the rest of the job, it's only paid out when the
            job is finished.
          </ThemedText>
          {busy ? <ActivityIndicator color="#111827" /> : (
            <View style={s.buttons}>
              <TouchableOpacity style={s.secondary} onPress={decline}>
                <ThemedText style={s.secondaryText}>Turn down</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity style={s.primary} onPress={approve}>
                <ThemedText style={s.primaryText}>Approve & pay</ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 12, padding: 16, borderRadius: 16, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', gap: 6 },
  title: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: '#111827' },
  amount: { fontSize: 22, lineHeight: 28, fontFamily: Fonts.poppinsBold, color: '#111827' },
  body: { fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppins, color: '#111827' },
  muted: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: '#6B7280' },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  secondary: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#F3F4F6' },
  secondaryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  primary: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', backgroundColor: '#FFCE48' },
  primaryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
});
