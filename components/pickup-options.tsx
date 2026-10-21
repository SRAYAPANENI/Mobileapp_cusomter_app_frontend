import { PickupOrderDetails } from '@/components/pickup-order-details';
import { Text, TextInput } from '@/components/scaled-text';
import { ShoppingListEditor } from '@/components/shopping-list-editor';
import { TimePickerModal } from '@/components/time-picker-modal';
import { Fonts } from '@/constants/theme';
import {
  MAX_PURCHASE_LIMIT, NOT_DELIVERED_NOTE, PickupDetails, PickupPurchase, PickupSource, PickupTiming, ShoppingItem,
  goodsHoldAmount, parseLimit, scheduleAt, shoppingFee,
} from '@/services/pickupOptions';
import { fromParts, sameDay, toParts } from '@/services/schedule-slots';
import { Ban, Clock } from 'lucide-react-native';
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface Props {
  timing: PickupTiming;
  onTimingChange: (t: PickupTiming) => void;
  purchase: PickupPurchase;
  onPurchaseChange: (p: PickupPurchase) => void;
  limitText: string;
  onLimitTextChange: (t: string) => void;
  notes: string;
  onNotesChange: (t: string) => void;
  details: PickupDetails;
  onDetailsChange: (d: PickupDetails) => void;
  items: ShoppingItem[];
  onItemsChange: (items: ShoppingItem[]) => void;
  editable: boolean;
  /** From a store (default) or a person. */
  source?: PickupSource;
}

// The Pickup & Drop choices the form needs beyond "what" and "where": when,
// who pays for the goods, how to find the door, and what can't be delivered.
// Controlled — the form owns the values; the rules are in pickupOptions.ts.
export function PickupOptions(p: Props) {
  const [day, setDay] = useState<0 | 1>(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const scheduled = p.timing.kind === 'SCHEDULED' ? p.timing : null;
  const pickedParts = scheduled?.at ? toParts(scheduled.at) : null;

  return (
    <View style={s.wrap}>
      <Text style={s.label}>When</Text>
      <Segmented
        options={[['ASAP', 'As soon as possible'], ['SCHEDULED', 'Schedule']]}
        value={p.timing.kind}
        onChange={(k) => p.onTimingChange(k === 'ASAP' ? { kind: 'ASAP' } : { kind: 'SCHEDULED', at: null })}
        editable={p.editable}
      />
      {scheduled && (
        <View style={s.scheduleRow}>
          {([0, 1] as const).map(d => (
            <TouchableOpacity
              key={d}
              disabled={!p.editable}
              style={[s.chip, day === d && s.chipOn]}
              onPress={() => { setDay(d); p.onTimingChange({ kind: 'SCHEDULED', at: null }); }}
            >
              <Text style={[s.chipText, day === d && s.chipTextOn]}>{d === 0 ? 'Today' : 'Tomorrow'}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity disabled={!p.editable} style={[s.chip, s.timeChip]} onPress={() => setPickerOpen(true)}>
            <Clock size={14} color="#374151" />
            <Text style={s.chipText}>
              {scheduled.at ? scheduled.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Pick a time'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* From a person nothing is bought, and who hands it over replaces the
          store's order details (pickup-dropoff-modal asks for that). */}
      {p.source !== 'PERSON' && (<>
      <Text style={s.label}>Paying for the order</Text>
      <Segmented
        options={[['PREPAID', 'Already paid — just collect'], ['BUY_FOR_ME', 'Buy it for me']]}
        value={p.purchase}
        onChange={(v) => p.onPurchaseChange(v as PickupPurchase)}
        editable={p.editable}
      />
      {p.purchase === 'BUY_FOR_ME' && (
        <View style={s.limitRow}>
          <Text style={s.hint}>The provider may spend up to</Text>
          <View style={s.amountBox}>
            <Text style={s.dollar}>$</Text>
            <TextInput
              style={s.amountInput}
              value={p.limitText}
              onChangeText={p.onLimitTextChange}
              keyboardType="decimal-pad"
              placeholder="50"
              placeholderTextColor="#9CA3AF"
              maxLength={7}
              editable={p.editable}
            />
          </View>
          <Text style={s.hint}>on the items (max ${MAX_PURCHASE_LIMIT})</Text>
        </View>
      )}
      {p.purchase === 'BUY_FOR_ME' && <HoldNote limitText={p.limitText} />}
      {p.purchase === 'BUY_FOR_ME'
        ? <ShoppingListEditor items={p.items} onChange={p.onItemsChange} editable={p.editable} />
        : <PickupOrderDetails details={p.details} onChange={p.onDetailsChange} editable={p.editable} />}
      </>)}

      <Text style={s.label}>Delivery instructions (optional)</Text>
      <TextInput
        style={s.notes}
        value={p.notes}
        onChangeText={p.onNotesChange}
        placeholder="Apartment, gate code, where to leave it…"
        placeholderTextColor="#9CA3AF"
        maxLength={500}
        multiline
        editable={p.editable}
      />

      <View style={s.notice}>
        <Ban size={14} color="#B45309" />
        <Text style={s.noticeText}>{NOT_DELIVERED_NOTE}</Text>
      </View>

      <TimePickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Pick a delivery time"
        selectedDateISO={scheduleAt(day, '12', '00', 'AM').toISOString()}
        initialSet={!!pickedParts}
        initialHour={pickedParts?.hour}
        initialMinute={pickedParts?.minute}
        initialPeriod={pickedParts?.period}
        onConfirm={(_label, hour, minute, period, picked) => {
          setPickerOpen(false);
          // The sheet can move the day ("Tomorrow 9 AM"): follow it, and the Today/Tomorrow toggle with it.
          const at = fromParts(picked.iso, { hour, minute, period: period as 'AM' | 'PM' });
          setDay(sameDay(at, new Date()) ? 0 : 1);
          p.onTimingChange({ kind: 'SCHEDULED', at });
        }}
      />
    </View>
  );
}

// How the shopping money works, in the customer's own numbers.
function HoldNote({ limitText }: { limitText: string }) {
  const limit = parseLimit(limitText);
  const text = limit && limit <= MAX_PURCHASE_LIMIT
    ? `After you hire, we hold $${goodsHoldAmount(limit).toFixed(2)} (items up to $${limit.toFixed(2)} + shopping fee up to $${shoppingFee(limit).toFixed(2)}) plus the card fee. You only pay for what's bought — the rest comes back to you.`
    : "After you hire, we hold your limit plus a 5% shopping fee. You only pay for what's bought — the rest comes back to you.";
  return <Text style={s.holdNote}>{text}</Text>;
}

function Segmented({ options, value, onChange, editable }: {
  options: [string, string][]; value: string; onChange: (v: string) => void; editable: boolean;
}) {
  return (
    <View style={s.segment}>
      {options.map(([key, label]) => (
        <TouchableOpacity
          key={key}
          disabled={!editable}
          style={[s.segmentItem, value === key && s.segmentOn]}
          onPress={() => onChange(key)}
        >
          <Text style={[s.segmentText, value === key && s.segmentTextOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 14 },
  label: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#374151', marginTop: 4 },
  segment: { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 12, padding: 3, gap: 3 },
  segmentItem: { flex: 1, paddingVertical: 9, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center' },
  segmentOn: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, elevation: 1 },
  segmentText: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppins, color: '#6B7280' },
  segmentTextOn: { fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  scheduleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#FFCE48', borderColor: '#FFCE48' },
  timeChip: { borderStyle: 'dashed' },
  chipText: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  chipTextOn: { color: '#111827' },
  limitRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  hint: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppins, color: '#6B7280' },
  amountBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingHorizontal: 10, height: 38, minWidth: 90 },
  dollar: { fontSize: 15, fontFamily: Fonts.poppinsSemiBold, color: '#111827', marginRight: 2 },
  amountInput: { flex: 1, fontSize: 15, fontFamily: Fonts.poppinsSemiBold, color: '#111827', paddingVertical: 0 },
  notes: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 10, minHeight: 54, fontSize: 13.5, fontFamily: Fonts.poppins, color: '#111827', textAlignVertical: 'top' },
  holdNote: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: '#4B5563', backgroundColor: '#F9FAFB', borderRadius: 10, padding: 10 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#FFFBEB', borderRadius: 10, padding: 10 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: '#92400E' },
});
