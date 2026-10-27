import { Text } from '@/components/scaled-text';
import { Fonts } from '@/constants/theme';
import React from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Flag } from 'react-native-country-picker-modal';

// US launch: phone numbers are US-only (the server accepts only +1), so the
// country code is a fixed label, not a picker. Used by login, register and
// forgot-password so all three look the same.
export const US_CALLING_CODE = '1';

/** At most the 10 digits of a US number. A pasted "+1 (555) 123-4567" keeps
 * its 10 digits — the leading country code is dropped. */
export function usPhoneDigits(text: string): string {
  let digits = text.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/** "5551234567" shown as "(555) 123-4567", formatted while typing. */
export function formatUsPhone(digits: string): string {
  const d = digits.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Characters in "(555) 123-4567". */
export const US_PHONE_INPUT_MAX = 14;

/** A real US number: 10 digits, area code not starting with 0 or 1 — what
 * the server accepts, so a bad one is caught here with a clear message. */
export function isUsPhone(digits: string): boolean {
  return /^[2-9]\d{9}$/.test(digits);
}

export function UsPhonePrefix({ style, textStyle }: { style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle> }) {
  return (
    <View style={[s.box, style]} accessible accessibilityLabel="United States, plus 1">
      {/* Every option passed explicitly: the library relies on defaultProps,
          which React 19 ignores (withFlagButton would default to no flag). */}
      <Flag countryCode="US" flagSize={20} withEmoji={false} withFlagButton />
      <Text style={[s.code, textStyle]}>+{US_CALLING_CODE}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  code: { fontFamily: Fonts.poppinsSemiBold, fontSize: 16 },
});
