import { Popup, PopupCard } from '@/components/popup';
import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { AlertTriangle, LifeBuoy, UserRound, XCircle } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type JobMenuAction = 'profile' | 'help' | 'report' | 'cancel';

// The tracking screen's "more" menu — the actions a customer needs now and
// then, kept off the screen so the ones they need all the time stand out.
// Cancel sits last and in red: hard to tap by accident. Same popup design as
// the rest of the app (Profile's photo popup, the photo picker).
export function JobMenu({ visible, canCancel, canReport, onPick, onClose }: {
  visible: boolean;
  canCancel: boolean;
  canReport: boolean;
  onPick: (action: JobMenuAction) => void;
  onClose: () => void;
}) {
  const t = Colors[useColorScheme() ?? 'light'];
  const insets = useSafeAreaInsets();
  const row = (action: JobMenuAction, label: string, icon: React.ReactNode, box: string, danger = false) => (
    <TouchableOpacity style={s.option} onPress={() => onPick(action)} accessibilityRole="button">
      <View style={[s.iconBox, { backgroundColor: box }]}>{icon}</View>
      <ThemedText style={[s.optionText, { color: danger ? '#EF4444' : t.textPrimary }]}>{label}</ThemedText>
    </TouchableOpacity>
  );
  return (
    <Popup closeOn="outside" visible={visible} transparent animationType="fade" onClose={onClose}>
      <View style={s.overlay}>
        <PopupCard style={[s.sheet, { backgroundColor: t.card, marginBottom: 24 + insets.bottom }]}>
          <View style={[s.header, { borderBottomColor: t.borderSubtle }]}>
            <ThemedText style={[s.title, { color: t.textPrimary }]}>This job</ThemedText>
          </View>
          {row('profile', 'View provider’s profile', <UserRound size={20} color="#0369A1" />, '#F0F9FF')}
          {row('help', 'Get help with this job', <LifeBuoy size={20} color="#0EA5E9" />, '#E0F2FE')}
          {canReport && row('report', 'Report an issue', <AlertTriangle size={20} color="#B45309" />, '#FFFBEB')}
          {canCancel && row('cancel', 'Cancel this job', <XCircle size={20} color="#EF4444" />, '#FEF2F2', true)}
        </PopupCard>
      </View>
    </Popup>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    width: '90%', borderRadius: 24, padding: 24, alignSelf: 'center',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 5,
  },
  header: { marginBottom: 16, borderBottomWidth: 1, paddingBottom: 12 },
  title: { fontSize: 18, lineHeight: 24, fontFamily: Fonts.poppinsBold },
  option: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  optionText: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.poppinsSemiBold },
});
