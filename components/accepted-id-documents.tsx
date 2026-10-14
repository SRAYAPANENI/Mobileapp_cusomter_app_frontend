import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Check, ChevronDown, ChevronUp, IdCard, Lock, X } from 'lucide-react-native';
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Which documents Dodorez accepts for identity verification (US launch).
// Kept here, one list, so the registration and profile screens say the same.
export const ACCEPTED_US_IDS = [
  "Driver's license (any US state)",
  'State ID card',
  'US passport or passport card',
  'Permanent Resident Card (Green Card)',
  'US military ID',
  'Employment Authorization Card (EAD)',
];

const REQUIREMENTS = [
  'Valid — not expired',
  'The name matches the name on your account',
  'A clear photo: all four corners visible, no glare or blur',
];

const NOT_ACCEPTED = 'Social Security card, birth certificate, student or work badge, or an expired ID';

// Accepted IDs at a glance, with the requirements one tap away.
export function AcceptedIdDocuments() {
  const t = Colors[useColorScheme() ?? 'light'];
  const [open, setOpen] = useState(false);

  return (
    <View style={[s.card, { backgroundColor: t.brand + '10', borderColor: t.brand + '40' }]}>
      <View style={s.titleRow}>
        <IdCard size={16} color={t.textPrimary} />
        <Text style={[s.title, { color: t.textPrimary }]}>Accepted US photo IDs</Text>
      </View>

      <View style={s.chips}>
        {ACCEPTED_US_IDS.map(id => (
          <View key={id} style={[s.chip, { backgroundColor: t.card, borderColor: t.borderSubtle }]}>
            <Text style={[s.chipText, { color: t.textPrimary }]}>{id}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={s.toggle} onPress={() => setOpen(o => !o)} hitSlop={6}>
        <Text style={[s.toggleText, { color: t.textPrimary }]}>{open ? 'Hide requirements' : 'ID requirements'}</Text>
        {open ? <ChevronUp size={14} color={t.textPrimary} /> : <ChevronDown size={14} color={t.textPrimary} />}
      </TouchableOpacity>

      {open && (
        <View style={s.details}>
          {REQUIREMENTS.map(r => (
            <View key={r} style={s.line}>
              <Check size={13} color="#10B981" strokeWidth={3} />
              <Text style={[s.lineText, { color: t.textPrimary }]}>{r}</Text>
            </View>
          ))}
          <View style={s.line}>
            <X size={13} color="#EF4444" strokeWidth={3} />
            <Text style={[s.lineText, { color: t.textPrimary }]}>Not accepted: {NOT_ACCEPTED}</Text>
          </View>
        </View>
      )}

      <View style={s.line}>
        <Lock size={12} color={t.textMuted} />
        <Text style={[s.privacy, { color: t.textMuted }]}>
          Only the Dodorez verification team sees your ID. It's never shown to customers or providers.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 11.5, lineHeight: 16, fontFamily: Fonts.poppins },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  toggleText: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, textDecorationLine: 'underline' },
  details: { gap: 6 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  lineText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins },
  privacy: { flex: 1, fontSize: 11.5, lineHeight: 16, fontFamily: Fonts.poppins },
});
