import { TextInput } from '@/components/scaled-text';
import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useHirePayment } from '@/hooks/use-hire-payment';
import { SkoFyApi, TipInfo } from '@/services/api';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';

interface Props {
  jobId: string | null;
  providerName: string;
  onClose: () => void;
  onMessage: (kind: 'success' | 'error' | 'info', title: string, message: string) => void;
}

// A tip after a finished job (docs/MONEY_RULES_DESIGN.md §11): all of it goes
// to the provider — no fees either side. Once per job, within a week.
export function TipSheet({ jobId, providerName, onClose, onMessage }: Props) {
  const { payTip } = useHirePayment();
  const [info, setInfo] = useState<TipInfo | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    setInfo(null); setChosen(null); setCustom('');
    if (jobId) SkoFyApi.jobs.tipInfo(jobId).then(setInfo).catch(() => onClose());
  }, [jobId]);

  const amount = custom ? parseFloat(custom) : chosen;
  const send = async () => {
    if (!jobId || !amount || amount <= 0) return;
    setPaying(true);
    const result = await payTip(jobId, amount);
    setPaying(false);
    if (result.status === 'success') {
      onMessage('success', 'Tip sent', `${providerName} gets all $${amount.toFixed(2)} of it.`);
      onClose();
    } else if (result.status === 'pending') {
      onMessage('info', 'Processing', result.message);
      onClose();
    } else if (result.status === 'error') {
      onMessage('error', 'Tip not sent', result.message);
    }
  };

  return (
    <Modal visible={!!jobId} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <ThemedText style={s.title}>Tip {providerName}</ThemedText>
          {!info ? <ActivityIndicator color="#111827" /> : !info.allowed ? (
            <ThemedText style={s.muted}>{info.reason}</ThemedText>
          ) : (
            <>
              <ThemedText style={s.muted}>All of it goes to them — Dodorez takes nothing from a tip.</ThemedText>
              <View style={s.row}>
                {info.suggestions.map((t) => (
                  <TouchableOpacity key={t} style={[s.chip, !custom && chosen === t && s.chipOn]} onPress={() => { setCustom(''); setChosen(t); }}>
                    <ThemedText style={s.chipText}>${t.toFixed(0)}</ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={s.input}
                placeholder="Other amount"
                placeholderTextColor="#9CA3AF"
                keyboardType="decimal-pad"
                value={custom}
                onChangeText={setCustom}
              />
            </>
          )}
          <View style={s.buttons}>
            <TouchableOpacity style={s.secondary} onPress={onClose} disabled={paying}>
              <ThemedText style={s.secondaryText}>{info?.allowed ? 'Not now' : 'Close'}</ThemedText>
            </TouchableOpacity>
            {info?.allowed && (
              <TouchableOpacity style={[s.primary, (!amount || amount <= 0 || paying) && { opacity: 0.5 }]} onPress={send}
                disabled={!amount || amount <= 0 || paying}>
                {paying ? <ActivityIndicator color="#111827" /> : (
                  <ThemedText style={s.primaryText}>{amount && amount > 0 ? `Tip $${amount.toFixed(2)}` : 'Tip'}</ThemedText>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 12 },
  title: { fontSize: 17, lineHeight: 23, fontFamily: Fonts.poppinsBold, color: '#111827' },
  muted: { fontSize: 12.5, lineHeight: 18, fontFamily: Fonts.poppins, color: '#6B7280' },
  row: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  chipOn: { borderColor: '#111827', backgroundColor: '#FEF3C7' },
  chipText: { fontSize: 15, lineHeight: 20, fontFamily: Fonts.poppinsBold, color: '#111827' },
  input: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppins, color: '#111827',
  },
  buttons: { flexDirection: 'row', gap: 10 },
  secondary: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#F3F4F6' },
  secondaryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  primary: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#FFCE48' },
  primaryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
});
