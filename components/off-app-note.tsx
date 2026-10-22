import { Text } from '@/components/scaled-text';
import { Fonts } from '@/constants/theme';
import { ShieldAlert } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';

// Under a chat message the server flagged (docs/MONEY_RULES_DESIGN.md §10):
// contact details were hidden, or it talks about paying some other way.
export function OffAppNote({ mark }: { mark?: 'CONTACT' | 'PAYMENT' | null }) {
  if (!mark) return null;
  return (
    <View style={s.row}>
      <ShieldAlert size={12} color="#B45309" />
      <Text style={s.text}>
        {mark === 'PAYMENT'
          ? "Pay only in the Dodorez app — money paid outside it isn't protected."
          : 'Phone numbers and emails are hidden — call and chat here instead.'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: 4, paddingHorizontal: 4 },
  text: { flexShrink: 1, fontSize: 11, lineHeight: 15, fontFamily: Fonts.poppins, color: '#92400E' },
});
