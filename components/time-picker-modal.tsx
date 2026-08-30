import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { SlideInUp } from 'react-native-reanimated';
import { X } from 'lucide-react-native';

const HOURS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const MINUTES = Array.from({ length: 60 }, (_, i) => i < 10 ? `0${i}` : `${i}`);
const PERIODS = ['AM', 'PM'];

const MIN_LEAD_MINUTES = 15;

function buildDateTime(dateISO: string, hour: string, minute: string, period: string): Date {
  const base = new Date(dateISO);
  let h24 = parseInt(hour, 10) % 12;
  if (period === 'PM') h24 += 12;
  base.setHours(h24, parseInt(minute, 10), 0, 0);
  return base;
}

interface TimePickerModalProps {
  visible: boolean;
  onClose: () => void;
  initialHour?: string;
  initialMinute?: string;
  initialPeriod?: string;
  selectedDateISO?: string | null;
  onConfirm: (label: string, hour: string, minute: string, period: string) => void;
}

const ITEM_HEIGHT = 52; // pickerItem height (48) + marginBottom (4)

// Shared by post-requirement/step2.tsx (creating a job) and edit-job.tsx
// (editing one) so both offer the identical time-picking experience.
export function TimePickerModal({
  visible, onClose, initialHour = '09', initialMinute = '00', initialPeriod = 'AM',
  selectedDateISO, onConfirm,
}: TimePickerModalProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const [selectedHour, setSelectedHour] = useState(initialHour);
  const [selectedMinute, setSelectedMinute] = useState(initialMinute);
  const [selectedPeriod, setSelectedPeriod] = useState(initialPeriod);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hourScrollRef = useRef<ScrollView>(null);
  const minuteScrollRef = useRef<ScrollView>(null);

  // When the modal opens, reset to the initial values and scroll to them.
  useEffect(() => {
    if (!visible) return;
    setSelectedHour(initialHour);
    setSelectedMinute(initialMinute);
    setSelectedPeriod(initialPeriod);
    setErrorMsg(null);
    const hourIdx = HOURS.indexOf(initialHour);
    const minIdx = parseInt(initialMinute, 10);
    // Small delay so the ScrollView has rendered before we scroll.
    const t = setTimeout(() => {
      if (hourIdx >= 0) hourScrollRef.current?.scrollTo({ y: hourIdx * ITEM_HEIGHT, animated: false });
      if (minIdx >= 0) minuteScrollRef.current?.scrollTo({ y: minIdx * ITEM_HEIGHT, animated: false });
    }, 80);
    return () => clearTimeout(t);
  }, [visible]);

  const confirmTimeSelection = () => {
    if (selectedDateISO) {
      const chosen = buildDateTime(selectedDateISO, selectedHour, selectedMinute, selectedPeriod);
      const earliest = new Date(Date.now() + MIN_LEAD_MINUTES * 60 * 1000);
      if (chosen < earliest) {
        setErrorMsg(`Please pick a time at least ${MIN_LEAD_MINUTES} minutes from now.`);
        return;
      }
    }
    setErrorMsg(null);

    const startTime = `${selectedHour}:${selectedMinute} ${selectedPeriod}`;

    let h = parseInt(selectedHour);
    let p = selectedPeriod;
    let endH = h + 2;
    let endP = p;
    if (endH > 12) {
      endH = endH - 12;
      endP = p === 'AM' ? 'PM' : 'AM';
    } else if (endH === 12) {
      endP = p === 'AM' ? 'PM' : 'AM';
    }
    const formattedEndH = endH < 10 ? `0${endH}` : `${endH}`;
    const endTime = `${formattedEndH}:${selectedMinute} ${endP}`;

    onConfirm(`${startTime} - ${endTime}`, selectedHour, selectedMinute, selectedPeriod);
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Animated.View entering={SlideInUp} style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>Available Slots</ThemedText>
            <TouchableOpacity onPress={onClose}>
              <X size={24} color={themeColors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.timePickerContainer}>
            <View style={styles.pickerColumn}>
              <ThemedText style={styles.pickerLabel}>Hour</ThemedText>
              <ScrollView ref={hourScrollRef} showsVerticalScrollIndicator={false} style={styles.columnScroll}>
                {HOURS.map(h => (
                  <TouchableOpacity
                    key={h}
                    onPress={() => { setSelectedHour(h); setErrorMsg(null); }}
                    style={[styles.pickerItem, selectedHour === h && { backgroundColor: themeColors.brand, borderRadius: 12 }]}
                  >
                    <ThemedText style={[styles.pickerItemText, selectedHour === h && { color: '#000', fontFamily: Fonts.poppinsBold }]}>{h}</ThemedText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.pickerColumn}>
              <ThemedText style={styles.pickerLabel}>Minute</ThemedText>
              <ScrollView ref={minuteScrollRef} showsVerticalScrollIndicator={false} style={styles.columnScroll}>
                {MINUTES.map(m => (
                  <TouchableOpacity
                    key={m}
                    onPress={() => { setSelectedMinute(m); setErrorMsg(null); }}
                    style={[styles.pickerItem, selectedMinute === m && { backgroundColor: themeColors.brand, borderRadius: 12 }]}
                  >
                    <ThemedText style={[styles.pickerItemText, selectedMinute === m && { color: '#000', fontFamily: Fonts.poppinsBold }]}>{m}</ThemedText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.pickerColumn}>
              <ThemedText style={styles.pickerLabel}>Period</ThemedText>
              <View style={styles.columnFixed}>
                {PERIODS.map(p => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => { setSelectedPeriod(p); setErrorMsg(null); }}
                    style={[styles.pickerItem, selectedPeriod === p && { backgroundColor: themeColors.brand, borderRadius: 12 }]}
                  >
                    <ThemedText style={[styles.pickerItemText, selectedPeriod === p && { color: '#000', fontFamily: Fonts.poppinsBold }]}>{p}</ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          {errorMsg && (
            <ThemedText style={styles.errorText}>{errorMsg}</ThemedText>
          )}

          <TouchableOpacity
            style={[styles.doneButton, { backgroundColor: themeColors.brand, marginTop: 12 }]}
            onPress={confirmTimeSelection}
          >
            <ThemedText style={styles.doneButtonText}>Set Time</ThemedText>
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
      maxHeight: '85%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
    modalTitle: {
      fontSize: 20,
      fontFamily: Fonts.poppinsBold,
      color: t.textPrimary,
    },
    timePickerContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      height: 250,
      gap: 12,
    },
    pickerColumn: {
      flex: 1,
      alignItems: 'center',
    },
    pickerLabel: {
      fontSize: 12,
      fontFamily: Fonts.poppinsBold,
      color: t.textMuted,
      marginBottom: 12,
      textTransform: 'uppercase',
    },
    columnScroll: {
      width: '100%',
    },
    columnFixed: {
      width: '100%',
      gap: 8,
    },
    pickerItem: {
      height: 48,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 4,
    },
    pickerItemText: {
      fontSize: 18,
      fontFamily: Fonts.poppinsSemiBold,
      color: t.textPrimary,
    },
    doneButton: {
      height: 56,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 20,
    },
    doneButtonText: {
      fontSize: 16,
      fontFamily: Fonts.poppinsBold,
      color: '#000',
    },
    errorText: {
      fontSize: 13,
      fontFamily: Fonts.poppinsSemiBold,
      color: '#EF4444',
      textAlign: 'center',
      marginTop: 12,
    },
  });
}
