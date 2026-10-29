import { DatePickerModal } from '@/components/date-picker-modal';
import { ThemedText } from '@/components/themed-text';
import { TimePickerModal } from '@/components/time-picker-modal';
import { Fonts } from '@/constants/theme';
import { HowLong, InCare, JobChoice, PRICING_RULES, SkillPricing, Where, bookedForSetTime, normalize, priceHint } from '@/services/job-shape';
import { fromParts } from '@/services/schedule-slots';
import { CalendarClock, Home, MapPin, Sparkles } from 'lucide-react-native';
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

const WHERE: { value: Where; label: string; Icon: typeof MapPin }[] = [
  { value: 'MY_PLACE', label: 'At my place', Icon: MapPin },
  { value: 'THEIR_PLACE', label: 'At their place', Icon: Home },
  { value: 'ONLINE', label: 'Online', Icon: Sparkles },
];

const HOW_LONG: { value: HowLong; label: string }[] = [
  { value: 'ONCE', label: 'One visit' },
  { value: 'HOURS', label: 'A few hours' },
  { value: 'DAYS', label: 'Over days' },
];

const IN_CARE: { value: InCare; label: string }[] = [
  { value: 'NONE', label: 'Nothing' },
  { value: 'LIVING_BEING', label: 'A pet' },
  { value: 'ITEM', label: 'An item' },
  { value: 'HOME', label: 'My home' },
];

const show = (iso: string | null) => iso
  ? new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : 'Choose';

interface Props {
  value: JobChoice;
  onChange: (next: JobChoice) => void;
  /** How the chosen skill is priced — only the questions it needs are asked. */
  pricing?: SkillPricing | null;
}

// Three plain questions instead of a form (docs/JOB_SHAPE_DESIGN.md): where,
// how long, and what's left with the provider. The price unit follows from
// them (services/job-shape.ts) and is explained in one line.
export function JobShapePicker({ value, onChange, pricing }: Props) {
  const set = (patch: Partial<JobChoice>) => onChange(normalize({ ...value, ...patch }, pricing));
  const rules = pricing ? PRICING_RULES[pricing] : null;
  const [picking, setPicking] = useState<{ field: 'startISO' | 'endISO'; step: 'day' | 'time'; dayISO?: string } | null>(null);
  const isDays = value.howLong === 'DAYS';

  return (
    <View style={s.wrap}>
      <ThemedText style={s.question}>Where?</ThemedText>
      <View style={s.row}>
        {WHERE.filter((w) => !rules || rules.wheres.includes(w.value)).map(({ value: v, label, Icon }) => (
          <TouchableOpacity key={v} style={[s.chip, value.where === v && s.chipOn]} onPress={() => set({ where: v })}>
            <Icon size={15} color="#111827" />
            <ThemedText style={[s.chipText, value.where === v && s.chipTextOn]}>{label}</ThemedText>
          </TouchableOpacity>
        ))}
      </View>

      {/* The skill's pricing fixes how long — the question is only asked without it. */}
      {!rules && (
        <>
          <ThemedText style={s.question}>How long?</ThemedText>
          <View style={s.row}>
            {HOW_LONG.filter((h) => !(value.where === 'ONLINE' && h.value === 'DAYS')
              && !(h.value === 'ONCE' && bookedForSetTime(value))).map((h) => (
              <TouchableOpacity key={h.value} style={[s.chip, value.howLong === h.value && s.chipOn]} onPress={() => set({ howLong: h.value })}>
                <ThemedText style={[s.chipText, value.howLong === h.value && s.chipTextOn]}>{h.label}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {value.howLong !== 'ONCE' && (
        <View style={s.dates}>
          {(['startISO', 'endISO'] as const).map((field) => (
            <TouchableOpacity key={field} style={s.dateField} onPress={() => setPicking({ field, step: 'day' })}>
              <CalendarClock size={15} color="#6B7280" />
              <View style={{ flex: 1 }}>
                <ThemedText style={s.dateLabel}>
                  {field === 'startISO' ? (isDays ? 'Drop-off / from' : 'From') : (isDays ? 'Pick-up / until' : 'Until')}
                </ThemedText>
                <ThemedText style={s.dateValue}>{show(value[field])}</ThemedText>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {value.where !== 'ONLINE' && (!rules || rules.inCares.length > 1) && (
        <>
          <ThemedText style={s.question}>Leaving anything with them?</ThemedText>
          <View style={[s.row, { flexWrap: 'wrap' }]}>
            {IN_CARE.filter((c) => (c.value !== 'HOME' || value.where === 'MY_PLACE')
              && (!rules || rules.inCares.includes(c.value))).map((c) => (
              <TouchableOpacity key={c.value} style={[s.chip, s.small, value.inCare === c.value && s.chipOn]}
                onPress={() => set({ inCare: c.value })}>
                <ThemedText style={[s.chipText, value.inCare === c.value && s.chipTextOn]}>{c.label}</ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <ThemedText style={s.hint}>{priceHint(value, pricing)}</ThemedText>
      {(value.inCare === 'LIVING_BEING' || value.inCare === 'HOME') && (
        <ThemedText style={s.hint}>
          Only background-checked providers can take this. You'll get photos at hand-over{value.howLong !== 'ONCE' ? ' and at least one update a day' : ''}.
        </ThemedText>
      )}

      <DatePickerModal
        visible={picking?.step === 'day'}
        onClose={() => setPicking(null)}
        selectedDateLabel={null}
        onSelect={(_label, iso) => setPicking((p) => (p ? { ...p, step: 'time', dayISO: iso } : null))}
      />
      <TimePickerModal
        visible={picking?.step === 'time'}
        onClose={() => setPicking(null)}
        selectedDateISO={picking?.dayISO ?? null}
        title={picking?.field === 'endISO' ? (isDays ? 'Pick-up time' : 'Ends at') : (isDays ? 'Drop-off time' : 'Starts at')}
        onConfirm={(_label, hour, minute, period, day) => {
          if (!picking) return;
          const at = fromParts(day.iso, { hour, minute, period: period as 'AM' | 'PM' });
          set({ [picking.field]: at.toISOString() } as Partial<JobChoice>);
          setPicking(null);
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  question: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#111827', marginTop: 4 },
  row: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 11, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff',
  },
  small: { flexBasis: '22%', flexGrow: 1 },
  chipOn: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  chipText: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppins, color: '#374151', textAlign: 'center' },
  chipTextOn: { color: '#111827', fontFamily: Fonts.poppinsBold },
  dates: { gap: 8 },
  dateField: {
    flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff',
  },
  dateLabel: { fontSize: 11.5, lineHeight: 15, fontFamily: Fonts.poppins, color: '#6B7280' },
  dateValue: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  hint: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: '#6B7280' },
});
