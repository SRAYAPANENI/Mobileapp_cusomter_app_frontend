import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ChevronDown } from 'lucide-react-native';
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

// A row that opens to show the fine print — prices, rules, breakdowns — so
// the screen leads with what's happening and keeps the details one tap away.
export function Disclosure({ label, icon, children, defaultOpen = false }: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const t = Colors[useColorScheme() ?? 'light'];
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View>
      <TouchableOpacity
        style={s.row}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        activeOpacity={0.7}
      >
        {icon}
        <ThemedText style={[s.label, { color: t.textPrimary }]}>{label}</ThemedText>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <ChevronDown size={18} color={t.textSecondary} />
        </View>
      </TouchableOpacity>
      {open && <Animated.View entering={FadeIn.duration(160)} style={s.body}>{children}</Animated.View>}
    </View>
  );
}

/** One label–value line inside a disclosure. */
export function DetailRow({ label, value, note }: { label: string; value: string; note?: string | null }) {
  const t = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={s.detail}>
      <View style={s.detailLine}>
        <ThemedText style={[s.detailLabel, { color: t.textSecondary }]}>{label}</ThemedText>
        <ThemedText style={[s.detailValue, { color: t.textPrimary }]}>{value}</ThemedText>
      </View>
      {!!note && <ThemedText style={[s.note, { color: t.textSecondary }]}>{note}</ThemedText>}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  label: { flex: 1, fontSize: 14.5, lineHeight: 20, fontFamily: Fonts.poppinsSemiBold },
  body: { gap: 10, paddingBottom: 6 },
  detail: { gap: 2 },
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppins },
  detailValue: { flexShrink: 1, textAlign: 'right', fontSize: 13, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold },
  note: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins },
});
