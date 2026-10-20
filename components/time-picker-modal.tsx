import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { padBottom, useBottomInset } from '@/hooks/use-bottom-inset';
import {
  addDays, byPartOfDay, dayLabel, fromParts, isPickable, quickPicks, sameDay, slotsFor, startOfDay,
  toParts, untilText, windowLabel,
} from '@/services/schedule-slots';
import { Clock3, X, Zap } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { SlideInUp } from 'react-native-reanimated';

interface TimePickerModalProps {
  visible: boolean;
  onClose: () => void;
  initialHour?: string;
  initialMinute?: string;
  initialPeriod?: string;
  /** Whether a time was already picked (otherwise nothing starts selected). */
  initialSet?: boolean;
  /** The day it's for (ISO); none = today. */
  selectedDateISO?: string | null;
  title?: string;
  /** `day` is the day the time is on — the sheet can move it to tomorrow. */
  onConfirm: (label: string, hour: string, minute: string, period: string, day: { label: string; iso: string }) => void;
}

// "3:30 PM" — compact, for the time chips.
function chipText(at: Date): string {
  const h = at.getHours() % 12 || 12;
  return `${h}:${String(at.getMinutes()).padStart(2, '0')} ${at.getHours() < 12 ? 'AM' : 'PM'}`;
}

// Shared by post-requirement/step2.tsx (creating a job) and edit-job.tsx
// (editing one). Only times still ahead are offered (services/schedule-slots.ts):
// past ones aren't greyed out, they simply don't exist — and the list keeps
// up while the sheet stays open.
export function TimePickerModal({
  visible, onClose, initialHour = '09', initialMinute = '00', initialPeriod = 'AM', initialSet = false,
  selectedDateISO, title = 'Pick a time', onConfirm,
}: TimePickerModalProps) {
  const bottomInset = useBottomInset();
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);

  const [now, setNow] = useState(() => new Date());
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [chosen, setChosen] = useState<Date | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Opening: the day it's for (never before today), and the time picked
  // before if it's still ahead. Too late for anything today: tomorrow.
  useEffect(() => {
    if (!visible) return;
    const current = new Date();
    setNow(current);
    const today = startOfDay(current);
    let start = selectedDateISO ? startOfDay(new Date(selectedDateISO)) : today;
    if (start < today) start = today;
    setNote(null);
    if (sameDay(start, today) && slotsFor(today, current).length === 0) {
      start = addDays(today, 1);
      setNote("It's late for today — showing tomorrow.");
    }
    setDay(start);
    const previous = initialSet
      ? fromParts(start.toISOString(), { hour: initialHour, minute: initialMinute, period: initialPeriod as 'AM' | 'PM' }, current)
      : null;
    setChosen(previous && isPickable(previous, current) ? previous : null);
  }, [visible]);

  // Keep up with the clock while open: a time that slips into the past goes.
  useEffect(() => {
    if (!visible) return;
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [visible]);
  useEffect(() => {
    if (chosen && !isPickable(chosen, now)) {
      setChosen(null);
      setNote('That time just passed — pick another.');
    }
  }, [now]);

  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const todayOpen = slotsFor(today, now).length > 0;
  const parts = useMemo(() => byPartOfDay(slotsFor(day, now)), [day, now]);
  const picks = useMemo(() => quickPicks(now), [now]);
  const otherDay = !sameDay(day, today) && !sameDay(day, tomorrow) ? day : null;

  const pick = (at: Date) => {
    setNote(null);
    setDay(startOfDay(at));
    setChosen(at);
  };

  const confirm = () => {
    const current = new Date();
    if (!chosen || !isPickable(chosen, current)) {
      setChosen(null);
      setNote('That time just passed — pick another.');
      return;
    }
    const p = toParts(chosen);
    const chosenDay = startOfDay(chosen);
    onConfirm(windowLabel(chosen), p.hour, p.minute, p.period, {
      label: dayLabel(chosenDay, current),
      iso: chosenDay.toISOString(),
    });
  };

  const dayChip = (d: Date, label: string, enabled = true) => {
    const active = sameDay(day, d);
    return (
      <TouchableOpacity
        key={label}
        disabled={!enabled}
        onPress={() => { setDay(d); setNote(null); if (chosen && !sameDay(chosen, d)) setChosen(null); }}
        style={[styles.dayChip, active && styles.dayChipActive, !enabled && { opacity: 0.4 }]}
      >
        <ThemedText style={[styles.dayChipText, active && styles.chipTextActive]}>{label}</ThemedText>
      </TouchableOpacity>
    );
  };

  return (
    <Modal statusBarTranslucent navigationBarTranslucent visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Animated.View entering={SlideInUp} style={padBottom(styles.modalContent, bottomInset)}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>{title}</ThemedText>
            <TouchableOpacity onPress={onClose}>
              <X size={24} color={themeColors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Day */}
          <View style={styles.dayRow}>
            {dayChip(today, todayOpen ? 'Today' : 'Today · full', todayOpen)}
            {dayChip(tomorrow, 'Tomorrow')}
            {otherDay && dayChip(otherDay, dayLabel(otherDay, now))}
          </View>

          {/* One tap for the usual cases */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow} keyboardShouldPersistTaps="handled">
            {picks.map((q) => {
              const active = chosen?.getTime() === q.at.getTime();
              return (
                <TouchableOpacity key={q.label} onPress={() => pick(q.at)} style={[styles.quickChip, active && styles.quickChipActive]}>
                  <Zap size={14} color={active ? '#000' : '#D97706'} />
                  <ThemedText style={[styles.quickText, active && styles.chipTextActive]}>{q.label}</ThemedText>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Every time still ahead on that day */}
          <ScrollView style={styles.slotScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {parts.map((part) => (
              <View key={part.title} style={styles.part}>
                <ThemedText style={styles.partTitle}>{part.title}</ThemedText>
                <View style={styles.slotGrid}>
                  {part.slots.map((at) => {
                    const active = chosen?.getTime() === at.getTime();
                    return (
                      <TouchableOpacity key={at.getTime()} onPress={() => pick(at)} style={[styles.slot, active && styles.slotActive]}>
                        <ThemedText style={[styles.slotText, active && styles.chipTextActive]}>{chipText(at)}</ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>

          {/* What's picked, and how far away it is */}
          <View style={styles.summary}>
            <Clock3 size={18} color={themeColors.brand} />
            {chosen ? (
              <ThemedText style={styles.summaryText}>
                {dayLabel(startOfDay(chosen), now)} · {chipText(chosen)}
                <ThemedText style={styles.summaryHint}>  —  {untilText(chosen, now)}</ThemedText>
              </ThemedText>
            ) : (
              <ThemedText style={styles.summaryHint}>Tap a time above</ThemedText>
            )}
          </View>
          {note && <ThemedText style={styles.noteText}>{note}</ThemedText>}

          <TouchableOpacity
            style={[styles.doneButton, { backgroundColor: themeColors.brand }, !chosen && { opacity: 0.5 }]}
            disabled={!chosen}
            onPress={confirm}
          >
            <ThemedText style={styles.doneButtonText}>Set time</ThemedText>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: t.modalBackground,
      borderTopLeftRadius: 32,
      borderTopRightRadius: 32,
      padding: 24,
      maxHeight: '88%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 20, lineHeight: 25,
      fontFamily: Fonts.poppinsBold,
      color: t.textPrimary,
    },
    dayRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    dayChip: {
      paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14,
      borderWidth: 1, borderColor: t.border, backgroundColor: t.card,
    },
    dayChipActive: { backgroundColor: t.brand, borderColor: t.brand },
    dayChipText: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
    chipTextActive: { color: '#000', fontFamily: Fonts.poppinsBold },
    quickRow: { gap: 8, paddingBottom: 14 },
    quickChip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
      backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A',
    },
    quickChipActive: { backgroundColor: t.brand, borderColor: t.brand },
    // Dark text in both themes: the chip is always light yellow.
    quickText: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#1F2937' },
    slotScroll: { maxHeight: 280 },
    part: { marginBottom: 12 },
    partTitle: {
      fontSize: 12, lineHeight: 16, fontFamily: Fonts.poppinsBold, color: t.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
    },
    slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    slot: {
      width: '23%', paddingVertical: 10, borderRadius: 12, alignItems: 'center',
      borderWidth: 1, borderColor: t.border, backgroundColor: t.card,
    },
    slotActive: { backgroundColor: t.brand, borderColor: t.brand },
    slotText: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: t.textPrimary },
    summary: {
      flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6,
      padding: 14, borderRadius: 14, backgroundColor: t.inputFilled,
    },
    summaryText: { flex: 1, fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    summaryHint: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppins, color: t.textSecondary },
    noteText: {
      fontSize: 13, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold,
      color: '#D97706', textAlign: 'center', marginTop: 10,
    },
    doneButton: {
      height: 56,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 14,
      marginBottom: 8,
    },
    doneButtonText: {
      fontSize: 16, lineHeight: 20,
      fontFamily: Fonts.poppinsBold,
      color: '#000',
    },
  });
}
