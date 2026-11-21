import { Text } from '@/components/scaled-text';
import { Fonts } from '@/constants/theme';
import React from 'react';
import { StyleSheet } from 'react-native';

// How a form shows what must be filled in: a red * after the label (inside
// the label's own Text, so it wraps with it), "* Required" once at the top,
// and a red outline on a field still missing once the form was sent.

export const REQUIRED_RED = '#EF4444';

/** The red * — put inside a label's Text. */
export function Req() {
  return <Text style={s.star} accessibilityLabel="required">{' *'}</Text>;
}

/** Says what the * means, once, at the top of the form. */
export function RequiredLegend() {
  return (
    <Text style={s.legend}>
      <Text style={s.starOnly}>*</Text> Required
    </Text>
  );
}

/** A field still missing after the form was sent: outlined in red. */
export const missingField = { borderColor: REQUIRED_RED, backgroundColor: '#FEF2F2' } as const;

const s = StyleSheet.create({
  star: { fontFamily: Fonts.poppinsBold, color: REQUIRED_RED },
  starOnly: { fontFamily: Fonts.poppinsBold, color: REQUIRED_RED },
  legend: { fontSize: 11.5, lineHeight: 16, fontFamily: Fonts.poppins, color: '#6B7280', marginBottom: 10 },
});
