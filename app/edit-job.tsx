import { useAppAlert } from '@/components/app-alert';
import { DatePickerModal } from '@/components/date-picker-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TimePickerModal } from '@/components/time-picker-modal';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SkoFyApi } from '@/services/api';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Clock3,
  Zap,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

const URGENCY_OPTIONS: { label: string; value: 'HIGH' | 'MEDIUM' | 'LOW'; icon: any }[] = [
  { label: 'Urgent', value: 'HIGH', icon: Zap },
  { label: 'Normal', value: 'MEDIUM', icon: CheckCircle2 },
  { label: 'Book Slot', value: 'LOW', icon: Clock3 },
];

// The backend stores one scheduled_at timestamp — this splits it back into
// the friendly date label + hour/minute/period the picker components work
// with, the inverse of computeScheduledAt below.
function parseScheduledAt(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const checkDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  let dateLabel: string;
  if (checkDate.getTime() === today.getTime()) dateLabel = 'Today';
  else if (checkDate.getTime() === tomorrow.getTime()) dateLabel = 'Tomorrow';
  else dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const hour24 = d.getHours();
  const period = hour24 >= 12 ? 'PM' : 'AM';
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  const hourStr = hour12 < 10 ? `0${hour12}` : `${hour12}`;
  const minuteStr = d.getMinutes() < 10 ? `0${d.getMinutes()}` : `${d.getMinutes()}`;

  return {
    dateLabel,
    dateISO: d.toISOString(),
    timeHour: hourStr,
    timeMinute: minuteStr,
    timePeriod: period,
    timeLabel: `${hourStr}:${minuteStr} ${period}`,
  };
}

function computeScheduledAt(dateISO: string | null, hour: string, minute: string, period: string): string | undefined {
  if (!dateISO) return undefined;
  const base = new Date(dateISO);
  let hour24 = parseInt(hour, 10) % 12;
  if (period === 'PM') hour24 += 12;
  base.setHours(hour24, parseInt(minute, 10), 0, 0);
  return base.toISOString();
}

export default function EditJobScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const alert = useAppAlert();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wasExpired, setWasExpired] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');

  const [dateLabel, setDateLabel] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string | null>(null);
  const [timeLabel, setTimeLabel] = useState<string | null>(null);
  const [timeHour, setTimeHour] = useState('09');
  const [timeMinute, setTimeMinute] = useState('00');
  const [timePeriod, setTimePeriod] = useState('AM');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  useEffect(() => {
    if (!jobId) {
      setLoading(false);
      setLoadError(true);
      return;
    }
    (async () => {
      try {
        const job: any = await SkoFyApi.jobs.get(jobId);
        // EXPIRED is editable too — the backend's update_job treats editing
        // an expired job as a repost: it clears old distributions and
        // redistributes to fresh providers (see job_service.py's
        // `was_expired` handling). Leaving it out here was the actual bug —
        // "Edit & Repost" on an expired job always dead-ended even though
        // the backend fully supports it.
        if (job.status !== 'POSTED' && job.status !== 'DISTRIBUTED' && job.status !== 'EXPIRED') {
          setLoadError(true);
          return;
        }
        setWasExpired(job.status === 'EXPIRED');
        setTitle(job.title ?? '');
        setDescription(job.description ?? '');
        setUrgency(job.urgency === 'EMERGENCY' ? 'HIGH' : (job.urgency ?? 'MEDIUM'));
        setBudgetMin(job.budget_min != null ? String(job.budget_min) : '');
        setBudgetMax(job.budget_max != null ? String(job.budget_max) : '');

        const parsed = parseScheduledAt(job.scheduled_at);
        if (parsed) {
          setDateLabel(parsed.dateLabel);
          setDateISO(parsed.dateISO);
          setTimeLabel(parsed.timeLabel);
          setTimeHour(parsed.timeHour);
          setTimeMinute(parsed.timeMinute);
          setTimePeriod(parsed.timePeriod);
        }
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [jobId]);

  useEffect(() => {
    if (loadError) {
      alert.show(
        'error',
        "Can't Edit This Job",
        'This job can no longer be edited — it may already have a provider hired, or it couldn\'t be loaded.',
        [{ text: 'Go Back', onPress: () => router.back() }],
      );
    }
  }, [loadError]);

  const handleSave = async () => {
    if (!jobId || saving || !title.trim()) return;
    const scheduledAt = computeScheduledAt(dateISO, timeHour, timeMinute, timePeriod);
    // A repost needs a fresh future time — the backend's expiry sweep runs
    // every 15 min and re-expires anything past its scheduled_at (or, for
    // an ASAP job with none, past the response window since it was
    // originally posted, which doesn't reset just by saving). Without this
    // check, resaving an expired job without touching the date picker would
    // silently get swept right back to EXPIRED on the next sweep.
    if (wasExpired && (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now())) {
      alert.show('error', 'Pick a New Time', 'This job expired, so it needs a fresh date & time before it can go back out to providers.');
      return;
    }
    setSaving(true);
    try {
      await SkoFyApi.jobs.update(jobId, {
        title: title.trim(),
        description: description.trim() || undefined,
        urgency,
        budget_min: budgetMin ? parseFloat(budgetMin) : undefined,
        budget_max: budgetMax ? parseFloat(budgetMax) : undefined,
        scheduled_at: scheduledAt,
      });
      alert.show(
        'success',
        wasExpired ? 'Job Reposted' : 'Job Updated',
        wasExpired ? "Your job is back out and searching for providers with the new time." : 'Your changes have been saved.',
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (err: any) {
      alert.show('error', 'Update Failed', err?.message ?? 'Could not save your changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ThemedView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={themeColors.brand} />
      </ThemedView>
    );
  }

  if (loadError) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ChevronLeft size={24} color="#000" />
          </TouchableOpacity>
          <ThemedText style={styles.headerTitle}>Edit Job</ThemedText>
        </View>
        {alert.element}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#000" />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Edit Job</ThemedText>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {wasExpired && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 10, padding: 10, marginBottom: 16 }}>
              <CalendarIcon size={16} color="#B45309" />
              <ThemedText style={{ fontSize: 12, color: '#92400E', flex: 1, fontFamily: Fonts.poppinsSemiBold }}>
                This job expired with no provider hired. Pick a new date & time below to repost it.
              </ThemedText>
            </View>
          )}

          <ThemedText style={styles.label}>Title</ThemedText>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Job title"
            placeholderTextColor={themeColors.textMuted}
          />

          <ThemedText style={styles.label}>Description</ThemedText>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe what you need"
            placeholderTextColor={themeColors.textMuted}
            multiline
          />

          <ThemedText style={styles.label}>Job Type</ThemedText>
          <View style={styles.urgencyRow}>
            {URGENCY_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => setUrgency(opt.value)}
                style={[styles.urgencyCard, urgency === opt.value && styles.urgencyCardActive]}
              >
                <opt.icon size={18} color={urgency === opt.value ? themeColors.brand : themeColors.textSecondary} />
                <ThemedText style={[styles.urgencyText, urgency === opt.value && styles.urgencyTextActive]}>
                  {opt.label}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>

          <ThemedText style={styles.label}>
            {urgency === 'HIGH' ? 'Deadline' : 'Schedule'}
          </ThemedText>
          <View style={styles.scheduleRow}>
            <TouchableOpacity style={styles.schedulePicker} onPress={() => setShowDatePicker(true)}>
              <CalendarIcon size={18} color={themeColors.brand} />
              <ThemedText style={styles.scheduleText}>{dateLabel ?? 'Date'}</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.schedulePicker} onPress={() => setShowTimePicker(true)}>
              <Clock size={18} color={themeColors.brand} />
              <ThemedText style={styles.scheduleText}>
                {timeLabel ? timeLabel.split(' - ')[0] : 'Time'}
              </ThemedText>
            </TouchableOpacity>
          </View>

          <ThemedText style={styles.label}>Budget Range ($)</ThemedText>
          <View style={styles.budgetRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={budgetMin}
              onChangeText={setBudgetMin}
              placeholder="Min"
              placeholderTextColor={themeColors.textMuted}
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={budgetMax}
              onChangeText={setBudgetMax}
              placeholder="Max"
              placeholderTextColor={themeColors.textMuted}
              keyboardType="numeric"
            />
          </View>

          <View style={{ height: 20 }} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveButton, (!title.trim() || saving) && { opacity: 0.5 }]}
            disabled={!title.trim() || saving}
            onPress={handleSave}
          >
            <ThemedText style={styles.saveButtonText}>
              {saving ? 'Saving...' : 'Save Changes'}
            </ThemedText>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <DatePickerModal
        visible={showDatePicker}
        onClose={() => setShowDatePicker(false)}
        selectedDateLabel={dateLabel}
        onSelect={(label, iso) => {
          setDateLabel(label);
          setDateISO(iso);
          setShowDatePicker(false);
        }}
      />

      <TimePickerModal
        visible={showTimePicker}
        onClose={() => setShowTimePicker(false)}
        initialHour={timeHour}
        initialMinute={timeMinute}
        initialPeriod={timePeriod}
        selectedDateISO={dateISO}
        onConfirm={(label, hour, minute, period) => {
          setTimeLabel(label);
          setTimeHour(hour);
          setTimeMinute(minute);
          setTimePeriod(period);
          setShowTimePicker(false);
        }}
      />

      {alert.element}
    </ThemedView>
  );
}

function makeStyles(t: typeof Colors.light) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.inputFilled },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: Platform.OS === 'ios' ? 60 : 40,
      paddingBottom: 20,
      backgroundColor: t.card,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    backButton: { width: 40, height: 40, justifyContent: 'center' },
    headerTitle: { fontSize: 18, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    scrollContent: { padding: 20, paddingBottom: 40 },
    label: {
      fontSize: 13,
      fontFamily: Fonts.poppinsSemiBold,
      color: t.textSecondary,
      marginBottom: 8,
      marginTop: 16,
    },
    input: {
      backgroundColor: t.card,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 14,
      fontFamily: Fonts.poppins,
      color: t.textPrimary,
      borderWidth: 1,
      borderColor: t.border,
    },
    textArea: {
      minHeight: 90,
      textAlignVertical: 'top',
    },
    urgencyRow: {
      flexDirection: 'row',
      gap: 10,
    },
    urgencyCard: {
      flex: 1,
      alignItems: 'center',
      gap: 6,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: t.card,
      borderWidth: 1,
      borderColor: t.border,
    },
    urgencyCardActive: {
      backgroundColor: '#FFFBEB',
      borderColor: t.brand,
    },
    urgencyText: {
      fontSize: 12,
      fontFamily: Fonts.poppinsSemiBold,
      color: t.textSecondary,
    },
    urgencyTextActive: {
      color: '#000',
      fontFamily: Fonts.poppinsBold,
    },
    scheduleRow: {
      flexDirection: 'row',
      gap: 12,
    },
    schedulePicker: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: t.card,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderWidth: 1,
      borderColor: t.border,
    },
    scheduleText: {
      fontSize: 14,
      fontFamily: Fonts.poppinsSemiBold,
      color: t.textPrimary,
    },
    budgetRow: {
      flexDirection: 'row',
      gap: 12,
    },
    footer: {
      padding: 20,
      backgroundColor: t.card,
      borderTopWidth: 1,
      borderTopColor: t.border,
    },
    saveButton: {
      backgroundColor: t.brand,
      height: 56,
      borderRadius: 28,
      justifyContent: 'center',
      alignItems: 'center',
    },
    saveButtonText: {
      fontSize: 16,
      fontFamily: Fonts.poppinsBold,
      color: '#000',
    },
  });
}
