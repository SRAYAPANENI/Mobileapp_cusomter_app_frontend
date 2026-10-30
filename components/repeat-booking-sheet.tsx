import { DatePickerModal } from '@/components/date-picker-modal';
import { TextInput } from '@/components/scaled-text';
import { ThemedText } from '@/components/themed-text';
import { TimePickerModal } from '@/components/time-picker-modal';
import { Fonts } from '@/constants/theme';
import { SkoFyApi } from '@/services/api';
import { fromParts } from '@/services/schedule-slots';
import { Repeat } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

const CADENCES: { value: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'; label: string }[] = [
  { value: 'WEEKLY', label: 'Every week' },
  { value: 'BIWEEKLY', label: 'Every 2 weeks' },
  { value: 'MONTHLY', label: 'Every month' },
];

interface Props {
  job: { jobId: string; providerName: string; lastPrice: number | null } | null;
  onClose: () => void;
  onMessage: (kind: 'success' | 'error' | 'info', title: string, message: string) => void;
}

// Book the same provider again on a schedule (docs/MONEY_RULES_DESIGN.md §13):
// each visit is booked for you a couple of days ahead, and a quote or a
// booking price at or under your limit is paid from your saved card.
export function RepeatBookingSheet({ job, onClose, onMessage }: Props) {
  const [cadence, setCadence] = useState<'WEEKLY' | 'BIWEEKLY' | 'MONTHLY'>('WEEKLY');
  const [day, setDay] = useState<{ label: string; iso: string } | null>(null);
  const [time, setTime] = useState<{ label: string; hour: string; minute: string; period: 'AM' | 'PM' } | null>(null);
  const [upTo, setUpTo] = useState('');
  const [picker, setPicker] = useState<'day' | 'time' | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setCadence('WEEKLY'); setDay(null); setTime(null);
    setUpTo(job?.lastPrice ? String(Math.ceil(job.lastPrice)) : '');
  }, [job?.jobId]);

  const firstAt = day && time ? fromParts(day.iso, time) : null;
  const send = async () => {
    if (!job || !firstAt) return;
    setSending(true);
    try {
      const limit = parseFloat(upTo);
      const result = await SkoFyApi.series.propose({
        job_id: job.jobId, cadence, first_at: firstAt.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        auto_accept_up_to: limit > 0 ? limit : undefined,
      });
      onMessage('success', 'Sent', result.message);
      onClose();
    } catch (err: any) {
      onMessage('error', 'Not sent', err?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
    <Modal visible={!!job && !picker} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.row}>
            <Repeat size={20} color="#111827" />
            <ThemedText style={s.title}>Book {job?.providerName ?? 'them'} regularly</ThemedText>
          </View>
          <View style={s.row}>
            {CADENCES.map((c) => (
              <TouchableOpacity key={c.value} style={[s.chip, cadence === c.value && s.chipOn]} onPress={() => setCadence(c.value)}>
                <ThemedText style={s.chipText}>{c.label}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>
          <ThemedText style={s.label}>First visit</ThemedText>
          <View style={s.row}>
            <TouchableOpacity style={s.field} onPress={() => setPicker('day')}>
              <ThemedText style={s.fieldText}>{day?.label ?? 'Day'}</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={s.field} onPress={() => setPicker('time')} disabled={!day}>
              <ThemedText style={[s.fieldText, !day && { color: '#9CA3AF' }]}>{time?.label ?? 'Time'}</ThemedText>
            </TouchableOpacity>
          </View>
          <ThemedText style={s.label}>Pay automatically up to ($)</ThemedText>
          <TextInput style={s.input} keyboardType="decimal-pad" value={upTo} onChangeText={setUpTo}
            placeholder="No limit" placeholderTextColor="#9CA3AF" />
          <ThemedText style={s.muted}>
            Leave it empty to approve each price yourself. Each visit is booked for you two days ahead. Any visiting fee, and a quote or booking price at or under this
            amount, is paid from your saved card and still held until the work is done. Pause or stop any time.
          </ThemedText>
          <View style={s.row}>
            <TouchableOpacity style={s.secondary} onPress={onClose} disabled={sending}>
              <ThemedText style={s.secondaryText}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primary, (!firstAt || sending) && { opacity: 0.5 }]} disabled={!firstAt || sending} onPress={send}>
              {sending ? <ActivityIndicator color="#111827" /> : <ThemedText style={s.primaryText}>Send to provider</ThemedText>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
      <DatePickerModal
        visible={picker === 'day'}
        onClose={() => setPicker(null)}
        selectedDateLabel={day?.label ?? null}
        onSelect={(label, iso) => { setDay({ label, iso }); setTime(null); setPicker(null); }}
      />
      <TimePickerModal
        visible={picker === 'time'}
        onClose={() => setPicker(null)}
        selectedDateISO={day?.iso ?? null}
        onConfirm={(label, hour, minute, period, pickedDay) => {
          setTime({ label, hour, minute, period: period as 'AM' | 'PM' });
          setDay(pickedDay);
          setPicker(null);
        }}
      />
    </>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  sheet: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, lineHeight: 23, fontFamily: Fonts.poppinsBold, color: '#111827' },
  label: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#374151', marginTop: 4 },
  muted: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: '#6B7280' },
  chip: { flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB' },
  chipOn: { borderColor: '#111827', backgroundColor: '#FEF3C7' },
  chipText: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  field: { flex: 1, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  fieldText: { fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppins, color: '#111827' },
  input: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppins, color: '#111827',
  },
  secondary: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#F3F4F6' },
  secondaryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  primary: { flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: '#FFCE48' },
  primaryText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
});
