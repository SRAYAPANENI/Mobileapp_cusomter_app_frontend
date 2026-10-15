import { Text, TextInput } from '@/components/scaled-text';
import { Fonts } from '@/constants/theme';
import { PickupDetails } from '@/services/pickupOptions';
import { Lock } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';

interface Props {
  details: PickupDetails;
  onChange: (d: PickupDetails) => void;
  editable: boolean;
}

const FIELDS: { key: keyof PickupDetails; label: string; placeholder: string; keyboard?: 'phone-pad' }[] = [
  { key: 'order_name', label: 'Name on the order', placeholder: 'e.g. John Smith' },
  { key: 'order_number', label: 'Order number', placeholder: 'e.g. #A1234' },
  { key: 'pickup_code', label: 'Store pickup code', placeholder: 'If the store gave you one' },
  { key: 'store_contact', label: 'Store phone', placeholder: 'If they need to call the store', keyboard: 'phone-pad' },
];

// Already paid: what the store needs to hand the order over. All optional —
// the customer can add the pickup code later from the tracking screen.
export function PickupOrderDetails({ details, onChange, editable }: Props) {
  return (
    <View style={s.wrap}>
      <Text style={s.label}>What the store needs (optional)</Text>
      <View style={s.grid}>
        {FIELDS.map(f => (
          <View key={f.key} style={s.cell}>
            <Text style={s.fieldLabel}>{f.label}</Text>
            <TextInput
              style={s.input}
              value={details[f.key] ?? ''}
              onChangeText={t => onChange({ ...details, [f.key]: t })}
              placeholder={f.placeholder}
              placeholderTextColor="#9CA3AF"
              keyboardType={f.keyboard}
              maxLength={f.key === 'pickup_code' ? 40 : 120}
              autoCapitalize={f.key === 'order_name' ? 'words' : 'characters'}
              editable={editable}
            />
          </View>
        ))}
      </View>
      <View style={s.privacy}>
        <Lock size={12} color="#6B7280" />
        <Text style={s.privacyText}>Only the provider you hire sees these.</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#374151', marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexGrow: 1, flexBasis: '46%', minWidth: 130, gap: 3 },
  fieldLabel: { fontSize: 11.5, lineHeight: 15, fontFamily: Fonts.poppins, color: '#6B7280' },
  input: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, paddingHorizontal: 10, height: 40, fontSize: 13.5, fontFamily: Fonts.poppins, color: '#111827' },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  privacyText: { fontSize: 11.5, lineHeight: 15, fontFamily: Fonts.poppins, color: '#6B7280' },
});
