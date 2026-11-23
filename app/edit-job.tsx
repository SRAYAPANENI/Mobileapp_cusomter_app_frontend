import { useAppAlert } from '@/components/app-alert';
import { OfflineScreen, useOfflinePage } from '@/components/offline-gate';
import { DatePickerModal } from '@/components/date-picker-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TimePickerModal } from '@/components/time-picker-modal';
import { fromParts, hasPassed, isPickable } from '@/services/schedule-slots';
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
  Lock,
  Users,
  Zap,
} from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { TextInput } from '@/components/scaled-text';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { padBottom, useBottomInset } from '@/hooks/use-bottom-inset';

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

/** What a job is can't change after it's posted — providers were matched
 * and price by it (the server takes none of it: UpdateJobRequest). Said
 * here, per kind of job, instead of leaving the customer to look for it. */
function fixedParts(job: any): string[] {
  const shape = job.shape ?? {};
  const parts: string[] = [];
  if (job.job_type === 'PICKUP_DROPOFF') {
    parts.push('The pickup and drop-off addresses', 'What’s carried and how big it is');
    if (job.pickup_purchase || job.purchase_limit != null) parts.push('What to buy and the spending limit');
  } else if (shape.venue === 'CUSTOMER_PLACE' || (!shape.venue && job.service_mode !== 'REMOTE')) {
    parts.push('The address');
  } else if (shape.venue === 'PROVIDER_PLACE') {
    parts.push('That it’s at the provider’s place');
  } else if (shape.venue === 'ONLINE') {
    parts.push('That it’s online');
  }
  if (shape.custody === 'LIVING_BEING') parts.push('The pets and their care details');
  if (shape.recurrence) parts.push('How it repeats');
  parts.push('The skills it needs', 'How it’s priced');
  return parts;
}

// Only when a time is set; no date picked means today (the time used to be dropped then).
function computeScheduledAt(timeSet: boolean, dateISO: string | null, hour: string, minute: string, period: string): string | undefined {
  if (!timeSet) return undefined;
  return fromParts(dateISO, { hour, minute, period: period as 'AM' | 'PM' }).toISOString();
}

export default function EditJobScreen() {
  const bottomInset = useBottomInset();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = React.useMemo(() => makeStyles(themeColors), [colorScheme]);
  const alert = useAppAlert();

  const [loading, setLoading] = useState(true);
  // Loaded once (then edits are the customer's — never reloaded under them),
  // and a way to load again after being offline.
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wasExpired, setWasExpired] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');

  const [dateLabel, setDateLabel] = useState<string | null>(null);
  const [dateISO, setDateISO] = useState<string | null>(null);
  const [timeLabel, setTimeLabel] = useState<string | null>(null);
  const [timeHour, setTimeHour] = useState('09');
  const [timeMinute, setTimeMinute] = useState('00');
  const [timePeriod, setTimePeriod] = useState('AM');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  // Sent only once moved: the time shown is sent back otherwise, and a job
  // whose time has passed couldn't have even its title fixed.
  const [startTouched, setStartTouched] = useState(false);

  // The end of a window or a stay — only those have one.
  const [hasEnd, setHasEnd] = useState(false);
  const [endDateLabel, setEndDateLabel] = useState<string | null>(null);
  const [endDateISO, setEndDateISO] = useState<string | null>(null);
  const [endTimeLabel, setEndTimeLabel] = useState<string | null>(null);
  const [endHour, setEndHour] = useState('09');
  const [endMinute, setEndMinute] = useState('00');
  const [endPeriod, setEndPeriod] = useState('AM');
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);
  const [endTouched, setEndTouched] = useState(false);

  // What kind of job this is decides what can change.
  const [job, setJob] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [dropoffNotes, setDropoffNotes] = useState('');
  const upfront = !!job && (job.steps ?? []).includes('PAY_UPFRONT');
  const isDelivery = job?.job_type === 'PICKUP_DROPOFF';
  const applicants: number = job?.applicant_count ?? 0;
  // Providers priced these dates: moving them would make their prices wrong.
  const datesLocked = upfront && applicants > 0;

  useEffect(() => {
    if (!jobId) {
      setLoading(false);
      setLoadError(true);
      return;
    }
    (async () => {
      setLoadError(false);   // a reload after a failed load starts clean
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
        setJob(job);
        setNotes(job.notes ?? '');
        setDropoffNotes(job.dropoff_notes ?? '');
        const end = parseScheduledAt(job.shape?.ends_at);
        setHasEnd(!!end);
        if (end) {
          setEndDateLabel(end.dateLabel);
          setEndDateISO(end.dateISO);
          setEndTimeLabel(end.timeLabel);
          setEndHour(end.timeHour);
          setEndMinute(end.timeMinute);
          setEndPeriod(end.timePeriod);
        }
        setLoadedOnce(true);
        setTitle(job.title ?? '');
        setDescription(job.description ?? '');
        setUrgency(job.urgency === 'EMERGENCY' ? 'HIGH' : (job.urgency ?? 'MEDIUM'));

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
  }, [jobId, reloadKey]);

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
    const scheduledAt = startTouched || wasExpired
      ? computeScheduledAt(!!timeLabel, dateISO, timeHour, timeMinute, timePeriod)
      : undefined;
    const endsAt = hasEnd && endTouched
      ? computeScheduledAt(!!endTimeLabel, endDateISO, endHour, endMinute, endPeriod)
      : undefined;
    if (hasEnd && (startTouched || endTouched)) {
      const start = computeScheduledAt(!!timeLabel, dateISO, timeHour, timeMinute, timePeriod);
      const end = computeScheduledAt(!!endTimeLabel, endDateISO, endHour, endMinute, endPeriod);
      if (start && end && new Date(end).getTime() <= new Date(start).getTime()) {
        alert.show('error', 'Check the times', 'It has to end after it starts.');
        return;
      }
    }
    // Changed to Urgent or Book Slot: those go out with a time. (A job already
    // posted without one keeps its other details editable.)
    const before = job?.urgency === 'EMERGENCY' ? 'HIGH' : (job?.urgency ?? 'MEDIUM');
    if (urgency !== before && urgency !== 'MEDIUM' && !timeLabel) {
      alert.show('error', urgency === 'HIGH' ? 'Set Your Deadline' : 'Pick a Time',
        urgency === 'HIGH' ? 'Say by when you need this done.' : 'Say when you want the provider to arrive.');
      return;
    }
    if (scheduledAt && !wasExpired && hasPassed(new Date(scheduledAt), new Date())) {
      alert.show('error', 'Pick a New Time', 'This job’s time has passed — pick a later one.');
      return;
    }
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
        scheduled_at: scheduledAt,
        ends_at: endsAt,
        // Sent once changed (empty clears them).
        notes: notes.trim() !== (job?.notes ?? '') ? notes.trim() : undefined,
        dropoff_notes: isDelivery && dropoffNotes.trim() !== (job?.dropoff_notes ?? '') ? dropoffNotes.trim() : undefined,
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

  // Offline with nothing loaded: the shared page; reloads when back online.
  const offline = useOfflinePage(loadedOnce, () => setReloadKey((k) => k + 1));
  if (offline) return <OfflineScreen onRetry={() => setReloadKey((k) => k + 1)} />;

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
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {wasExpired && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF3C7', borderRadius: 10, padding: 10, marginBottom: 16 }}>
              <CalendarIcon size={16} color="#B45309" />
              <ThemedText style={{ fontSize: 12, color: '#92400E', flex: 1, fontFamily: Fonts.poppinsSemiBold }}>
                This job expired with no provider hired. Pick a new date & time below to repost it.
              </ThemedText>
            </View>
          )}

          {applicants > 0 && (!wasExpired || datesLocked) && (
            <View style={styles.notice}>
              <Users size={16} color="#1D4ED8" />
              <ThemedText style={styles.noticeText}>
                {applicants} provider{applicants === 1 ? ' has' : 's have'} applied.
                {datesLocked
                  ? ' They priced these dates, so the dates can’t move — cancel and post again to change them.'
                  : ' If you change the time, they’re told so they can check it still works for them.'}
              </ThemedText>
            </View>
          )}

          <ThemedText style={styles.label}>Title</ThemedText>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            maxLength={200}
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
            {hasEnd ? 'Starts' : urgency === 'HIGH' ? 'Deadline' : 'Schedule'}
          </ThemedText>
          <View style={[styles.scheduleRow, datesLocked && styles.locked]}>
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

          {hasEnd && (
            <>
              <ThemedText style={styles.label}>Ends</ThemedText>
              <View style={[styles.scheduleRow, datesLocked && styles.locked]}>
                <TouchableOpacity style={styles.schedulePicker} onPress={() => setShowEndDatePicker(true)}>
                  <CalendarIcon size={18} color={themeColors.brand} />
                  <ThemedText style={styles.scheduleText}>{endDateLabel ?? 'Date'}</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity style={styles.schedulePicker} onPress={() => setShowEndTimePicker(true)}>
                  <Clock size={18} color={themeColors.brand} />
                  <ThemedText style={styles.scheduleText}>
                    {endTimeLabel ? endTimeLabel.split(' - ')[0] : 'Time'}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </>
          )}

          <ThemedText style={styles.label}>Anything else providers should know</ThemedText>
          <ThemedText style={styles.hint}>Every provider it reaches sees this — keep codes and keys for the one you hire, in chat.</ThemedText>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Parking, what to bring, anything to know…"
            placeholderTextColor={themeColors.textMuted}
            maxLength={10000}
            multiline
          />

          {isDelivery && (
            <>
              <ThemedText style={styles.label}>At the drop-off</ThemedText>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={dropoffNotes}
                onChangeText={setDropoffNotes}
                placeholder="Leave it with the front desk, call on arrival…"
                placeholderTextColor={themeColors.textMuted}
                maxLength={500}
                multiline
              />
            </>
          )}

          {/* What can't change, and why — not left for the customer to find. */}
          {!!job && (
            <View style={styles.fixedCard}>
              <View style={styles.fixedHead}>
                <Lock size={15} color={themeColors.textSecondary} />
                <ThemedText style={styles.fixedTitle}>Can’t be changed after posting</ThemedText>
              </View>
              {fixedParts(job).map((part) => (
                <ThemedText key={part} style={styles.fixedItem}>• {part}</ThemedText>
              ))}
              <ThemedText style={styles.fixedHint}>
                Providers were matched{upfront ? ' and priced it' : ''} by these. To change one, cancel this job and post it again.
              </ThemedText>
            </View>
          )}

          <View style={{ height: 20 }} />
        </ScrollView>

        <View style={padBottom(styles.footer, bottomInset)}>
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
          setStartTouched(true);
          // A time the new date leaves behind now is cleared, not kept.
          if (timeLabel && !isPickable(fromParts(iso, { hour: timeHour, minute: timeMinute, period: timePeriod as 'AM' | 'PM' }), new Date())) {
            setTimeLabel(null);
          }
          setShowDatePicker(false);
        }}
      />

      <TimePickerModal
        visible={showTimePicker}
        onClose={() => setShowTimePicker(false)}
        title={urgency === 'HIGH' ? 'Set your deadline' : 'Pick a time'}
        initialHour={timeHour}
        initialMinute={timeMinute}
        initialPeriod={timePeriod}
        initialSet={!!timeLabel}
        selectedDateISO={dateISO}
        onConfirm={(label, hour, minute, period, day) => {
          setTimeLabel(label);
          setTimeHour(hour);
          setTimeMinute(minute);
          setTimePeriod(period);
          // The sheet can move the day (Today / Tomorrow / "Tomorrow 9 AM").
          setDateLabel(day.label);
          setDateISO(day.iso);
          setStartTouched(true);
          setShowTimePicker(false);
        }}
      />

      <DatePickerModal
        visible={showEndDatePicker}
        onClose={() => setShowEndDatePicker(false)}
        selectedDateLabel={endDateLabel}
        onSelect={(label, iso) => {
          setEndDateLabel(label);
          setEndDateISO(iso);
          setEndTouched(true);
          setShowEndDatePicker(false);
        }}
      />

      <TimePickerModal
        visible={showEndTimePicker}
        onClose={() => setShowEndTimePicker(false)}
        title="When it ends"
        initialHour={endHour}
        initialMinute={endMinute}
        initialPeriod={endPeriod}
        initialSet={!!endTimeLabel}
        selectedDateISO={endDateISO}
        onConfirm={(label, hour, minute, period, day) => {
          setEndTimeLabel(label);
          setEndHour(hour);
          setEndMinute(minute);
          setEndPeriod(period);
          setEndDateLabel(day.label);
          setEndDateISO(day.iso);
          setEndTouched(true);
          setShowEndTimePicker(false);
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
    headerTitle: { fontSize: 18, lineHeight: 22, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    scrollContent: { padding: 20, paddingBottom: 40 },
    label: {
      fontSize: 13, lineHeight: 17,
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
      fontSize: 14, lineHeight: 18,
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
      fontSize: 12, lineHeight: 16,
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
      fontSize: 14, lineHeight: 18,
      fontFamily: Fonts.poppinsSemiBold,
      color: t.textPrimary,
    },
    notice: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: '#EFF6FF', borderRadius: 10, padding: 10, marginBottom: 4,
    },
    noticeText: { fontSize: 12, lineHeight: 18, color: '#1E3A8A', flex: 1, fontFamily: Fonts.poppinsSemiBold },
    // Dates providers priced: shown, but not tappable.
    locked: { opacity: 0.45, pointerEvents: 'none' },
    hint: { fontSize: 11, lineHeight: 16, fontFamily: Fonts.poppins, color: t.textMuted, marginTop: -4, marginBottom: 8 },
    fixedCard: {
      marginTop: 24, borderRadius: 14, padding: 14, gap: 4,
      backgroundColor: t.card, borderWidth: 1, borderColor: t.border,
    },
    fixedHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
    fixedTitle: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsBold, color: t.textPrimary },
    fixedItem: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppins, color: t.textSecondary },
    fixedHint: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: t.textMuted, marginTop: 6 },
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
      fontSize: 16, lineHeight: 20,
      fontFamily: Fonts.poppinsBold,
      color: '#000',
    },
  });
}
