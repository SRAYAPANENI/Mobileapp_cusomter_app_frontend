import { Fonts } from '@/constants/theme';
import { clipboardText, LinkError } from '@/services/location-link';
import { ClipboardPaste } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { Text } from '@/components/scaled-text';

/**
 * "Paste a location link" — under any address box. Hands the copied link
 * to `onLink` (the screen reads it with services/location-link.ts), or says
 * why there's nothing to use (`onError`).
 */
export function PasteLocationLink({
  onLink, onError, hint = 'shared on WhatsApp or Google Maps', disabled,
}: {
  onLink: (link: string) => void;
  onError: (message: string) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const paste = async () => {
    try {
      onLink(await clipboardText());
    } catch (e) {
      onError(e instanceof LinkError ? e.message : "Couldn't read what's copied. Type the address instead.");
    }
  };
  return (
    <TouchableOpacity style={s.row} onPress={paste} disabled={disabled} accessibilityRole="button"
      accessibilityLabel={`Paste a location link, ${hint}`}>
      <ClipboardPaste size={14} color="#0EA5E9" />
      <Text style={s.text}>Paste a location link</Text>
      <Text style={s.hint}>{hint}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6, paddingVertical: 2 },
  text: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsBold, color: '#0EA5E9' },
  hint: { fontSize: 11.5, lineHeight: 16, fontFamily: Fonts.poppins, color: '#6B7280' },
});
