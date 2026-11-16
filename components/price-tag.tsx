import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { Tag } from 'lucide-react-native';
import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

// A price on a card, made to be seen: a brand-yellow tag with the amount
// large and bold, then what it's for ("fare", "total", "/night"). The
// provider app keeps an identical copy (components/price-tag.tsx).

interface Props {
  /** "$6.15", "$40–$60" */
  amount: string;
  /** What it's for, small after the amount: "fare", "total", "/night". */
  unit?: string;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}

export function PriceTag({ amount, unit, size = 'md', style }: Props) {
  const lg = size === 'lg';
  return (
    <View style={[s.tag, lg && s.tagLg, style]} accessibilityLabel={unit ? `${amount} ${unit}` : amount}>
      <Tag size={lg ? 15 : 13} color="#7A5600" />
      <ThemedText style={[s.amount, lg && s.amountLg]}>{amount}</ThemedText>
      {!!unit && <ThemedText style={s.unit}>{unit}</ThemedText>}
    </View>
  );
}

const s = StyleSheet.create({
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10,
    backgroundColor: '#FFF7DB', borderWidth: 1, borderColor: '#FFCE48',
  },
  tagLg: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  amount: { fontSize: 16, lineHeight: 22, fontFamily: Fonts.poppinsBold, color: '#111827' },
  amountLg: { fontSize: 19, lineHeight: 26 },
  unit: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#7A5600' },
});
