import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React, { useMemo, useState } from 'react';
import { Dimensions, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { SlideInUp } from 'react-native-reanimated';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';

const { width } = Dimensions.get('window');

const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate();
const getFirstDayOfMonth = (month: number, year: number) => new Date(year, month, 1).getDay();

interface DatePickerModalProps {
  visible: boolean;
  onClose: () => void;
  selectedDateLabel: string | null;
  onSelect: (label: string, iso: string) => void;
}

// Shared by post-requirement/step2.tsx (creating a job) and edit-job.tsx
// (editing one) so both offer the identical date-picking experience.
export function DatePickerModal({ visible, onClose, selectedDateLabel, onSelect }: DatePickerModalProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const [viewDate, setViewDate] = useState(new Date());

  const calendarDays = useMemo(() => {
    const month = viewDate.getMonth();
    const year = viewDate.getFullYear();
    const daysInMonth = getDaysInMonth(month, year);
    const firstDay = getFirstDayOfMonth(month, year);
    const days: (Date | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
    return days;
  }, [viewDate]);

  const isSelectedDate = (date: Date) => {
    if (!selectedDateLabel) return false;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (selectedDateLabel === 'Today') return checkDate.getTime() === today.getTime();
    if (selectedDateLabel === 'Tomorrow') return checkDate.getTime() === tomorrow.getTime();
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) === selectedDateLabel;
  };

  const isDateDisabled = (date: Date) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return date < today;
  };

  const handleSelectDate = (date: Date) => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    let dateStr = '';
    if (selectedDate.getTime() === today.getTime()) {
      dateStr = 'Today';
    } else if (selectedDate.getTime() === tomorrow.getTime()) {
      dateStr = 'Tomorrow';
    } else {
      dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    onSelect(dateStr, date.toISOString());
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Animated.View entering={SlideInUp} style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <ThemedText style={styles.modalTitle}>Select Date</ThemedText>
            <TouchableOpacity onPress={onClose}>
              <X size={24} color={themeColors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.calendarHeader}>
            <TouchableOpacity onPress={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1))}>
              <ChevronLeft size={24} color={themeColors.textPrimary} />
            </TouchableOpacity>
            <ThemedText style={styles.calendarMonthText}>
              {viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </ThemedText>
            <TouchableOpacity onPress={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1))}>
              <ChevronRight size={24} color={themeColors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.dayNamesRow}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <ThemedText key={i} style={styles.dayName}>{d}</ThemedText>
            ))}
          </View>

          <View style={styles.daysGrid}>
            {calendarDays.map((date, i) => {
              if (!date) return <View key={`empty-${i}`} style={styles.dayCell} />;
              const disabled = isDateDisabled(date);
              const selected = isSelectedDate(date);
              return (
                <TouchableOpacity
                  key={i}
                  disabled={disabled}
                  onPress={() => handleSelectDate(date)}
                  style={[styles.dayCell, selected && { backgroundColor: themeColors.brand, borderRadius: 12 }]}
                >
                  <ThemedText style={[
                    styles.dayText,
                    disabled && { opacity: 0.3 },
                    selected && { color: '#000', fontFamily: Fonts.poppinsBold },
                  ]}>
                    {date.getDate()}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
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
    calendarHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
      paddingHorizontal: 8,
    },
    calendarMonthText: {
      fontSize: 18,
      fontFamily: Fonts.poppinsBold,
      color: t.textPrimary,
    },
    dayNamesRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    dayName: {
      width: (width - 80) / 7,
      textAlign: 'center',
      fontSize: 13,
      fontFamily: Fonts.poppinsBold,
      color: t.textMuted,
    },
    daysGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-start',
    },
    dayCell: {
      width: (width - 48) / 7,
      height: (width - 48) / 7,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 4,
    },
    dayText: {
      fontSize: 15,
      fontFamily: Fonts.poppinsSemiBold,
      color: t.textPrimary,
    },
  });
}
