import { Popup, PopupCard } from '@/components/popup';
import { Text } from '@/components/scaled-text';
import { Fonts } from '@/constants/theme';
import { AlertTriangle, Info } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface TripEstimate {
  /** "From $12.40" (nearby providers' own fares) or "Around $30.90" (a typical fare). */
  text: string;
  /** "About 16.6 mi · most nearby providers charge $12–$18" and the like. */
  detail?: string;
  typical: boolean;
  /** Nobody nearby carries this size yet. */
  note: string | null;
  /** Buy it for me: how many nearby buy for customers that much. */
  buyNote?: string;
}

/** The trip's length, from the estimate's detail ("About 16.6 mi · …" → "About 16.6 mi"). */
export function estimateMiles(e: TripEstimate): string | null {
  return e.detail ? e.detail.split(' · ')[0] : null;
}

/** Something the customer should read before posting (shown as "Read note"). */
export function hasEstimateNote(e: TripEstimate): boolean {
  return !!e.note || !!e.buyNote;
}

// The price estimate in full — what it's based on, and how the real price is
// set — opened from the posting screen's one-line price. Kept off the screen
// itself: it rode up with the keyboard and crowded every field being typed.
// Same popup design as the rest of the app.
export function PriceEstimateInfo({ estimate, visible, onClose }: {
  estimate: TripEstimate | null; visible: boolean; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  if (!estimate) return null;
  return (
    <Popup closeOn="outside" visible={visible} transparent animationType="fade" onClose={onClose}>
      <View style={s.overlay}>
        <PopupCard style={[s.sheet, { marginBottom: 24 + insets.bottom }]}>
          <View style={s.header}>
            <Info size={18} color="#0369A1" />
            <Text style={s.title}>About this price</Text>
          </View>
          <Text style={s.price}>{estimate.text}</Text>
          {!!estimate.detail && <Text style={s.body}>{estimate.detail}</Text>}

          {(estimate.note || estimate.buyNote) && (
            <View style={s.note}>
              <AlertTriangle size={16} color="#B45309" />
              <View style={{ flex: 1, gap: 6 }}>
                {!!estimate.note && <Text style={s.noteText}>{estimate.note}</Text>}
                {!!estimate.buyNote && <Text style={s.noteText}>{estimate.buyNote}</Text>}
              </View>
            </View>
          )}

          <View style={s.points}>
            <Point text={estimate.typical
              ? 'A typical local fare — no one nearby has set their own fare yet.'
              : 'The lowest fare a nearby provider has set for this trip.'} />
            <Point text="Each provider sets their own fare. You see every applicant's exact price before you hire." />
            <Point text="No visiting fee and no invoice: you pay when you book." />
          </View>

          <TouchableOpacity style={s.button} onPress={onClose} accessibilityRole="button">
            <Text style={s.buttonText}>Got it</Text>
          </TouchableOpacity>
        </PopupCard>
      </View>
    </Popup>
  );
}

function Point({ text }: { text: string }) {
  return (
    <View style={s.point}>
      <View style={s.bullet} />
      <Text style={s.body}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    width: '90%', alignSelf: 'center', borderRadius: 24, padding: 24, gap: 10, backgroundColor: '#FFFFFF',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  title: { fontSize: 18, lineHeight: 24, fontFamily: Fonts.poppinsBold, color: '#111827' },
  price: { fontSize: 26, lineHeight: 34, fontFamily: Fonts.poppinsBold, color: '#111827', marginTop: 4 },
  body: { flex: 1, fontSize: 13.5, lineHeight: 20, fontFamily: Fonts.poppins, color: '#4B5563' },
  note: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: 12, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' },
  noteText: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#92400E' },
  points: { gap: 8, marginTop: 4 },
  point: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#9CA3AF', marginTop: 7 },
  button: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFCE48', marginTop: 8 },
  buttonText: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: '#111827' },
});
