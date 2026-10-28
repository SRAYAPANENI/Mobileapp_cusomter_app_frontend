import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { Box, PawPrint } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';

const PET_KIND: Record<string, string> = {
  DOG: 'Dog', CAT: 'Cat', BIRD: 'Bird', SMALL_PET: 'Small pet', REPTILE: 'Reptile', FISH: 'Fish', OTHER: 'Animal',
};
const DOG_SIZE: Record<string, string> = { SMALL: 'small', MEDIUM: 'medium', LARGE: 'large', GIANT: 'giant' };
const ITEM_SIZE: Record<string, string> = { SMALL: 'small', MEDIUM: 'medium', LARGE: 'large', BULKY: 'bulky' };

function Line({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <ThemedText style={s.line}><ThemedText style={s.label}>{label}: </ThemedText>{value}</ThemedText>;
}

// What you told the provider about your pet or item (services/care-sheet.ts),
// on your job's page — the provider you book sees this too, with the vet and
// emergency contact.
export function CareSheetSummary({ custody, sheet }: { custody?: string | null; sheet?: Record<string, any> | null }) {
  if (!sheet || Object.keys(sheet).length === 0) return null;

  if (custody === 'LIVING_BEING') {
    const pets: any[] = sheet.pets ?? [];
    return (
      <View style={s.card}>
        <View style={s.head}><PawPrint size={16} color="#111827" /><ThemedText style={s.title}>What you told the provider</ThemedText></View>
        {pets.map((p, i) => (
          <ThemedText key={i} style={s.name}>
            {p.name} · {PET_KIND[p.kind] ?? p.kind}{p.breed ? `, ${p.breed}` : ''}{p.size ? ` · ${DOG_SIZE[p.size]}` : ''}
          </ThemedText>
        ))}
        <Line label="Food" value={`${sheet.food?.by === 'HOST' ? 'Provider supplies it' : "You're bringing it"}${sheet.food?.what ? ` — ${sheet.food.what}` : ''}${sheet.food?.schedule ? `, ${sheet.food.schedule}` : ''}`} />
        <Line label="Medicines" value={sheet.medication} />
        <Line label="Walks" value={sheet.walks} />
        <Line label="Vet" value={[sheet.vet?.name, sheet.vet?.phone].filter(Boolean).join(' · ')} />
        <Line label="Emergency contact" value={[sheet.emergency?.name, sheet.emergency?.phone].filter(Boolean).join(' · ')} />
        <Line label="Notes" value={sheet.notes} />
      </View>
    );
  }

  if (custody === 'ITEM') {
    return (
      <View style={s.card}>
        <View style={s.head}><Box size={16} color="#111827" /><ThemedText style={s.title}>What you're leaving</ThemedText></View>
        <ThemedText style={s.name}>{sheet.count > 1 ? `${sheet.count} × ` : ''}{sheet.what} · {ITEM_SIZE[sheet.size] ?? ''}</ThemedText>
        <Line label="Worth" value={sheet.value != null ? `$${Number(sheet.value).toFixed(0)}` : null} />
        {sheet.fragile && <ThemedText style={s.line}>Fragile</ThemedText>}
        <Line label="Notes" value={sheet.notes} />
      </View>
    );
  }
  return null;
}

const s = StyleSheet.create({
  card: { gap: 4, padding: 14, borderRadius: 16, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', marginBottom: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
  name: { fontSize: 13.5, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  line: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppins, color: '#374151' },
  label: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
});
