import { Text, TextInput } from '@/components/scaled-text';
import { Fonts } from '@/constants/theme';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

/** What the customer said, sent with their rating (docs/MONEY_RULES_DESIGN.md §10). */
export interface OffAppAnswer {
  provider_asked_off_app: boolean | null;
  off_app_note?: string;
}

export const NO_OFF_APP_ANSWER: OffAppAnswer = { provider_asked_off_app: null };

// "Did they ask you to pay outside the app?" — optional, under the rating.
// A yes goes to our team, who decide whether it's a strike.
export function OffAppQuestion({ providerName, value, onChange }: {
  providerName: string;
  value: OffAppAnswer;
  onChange: (answer: OffAppAnswer) => void;
}) {
  const asked = value.provider_asked_off_app;
  const choose = (yes: boolean) => onChange({ provider_asked_off_app: asked === yes ? null : yes, off_app_note: value.off_app_note });

  return (
    <View style={s.wrap}>
      <Text style={s.question}>Did {providerName} ask you to pay outside the app?</Text>
      <View style={s.choices}>
        {([false, true] as const).map((yes) => (
          <TouchableOpacity key={String(yes)} style={[s.choice, asked === yes && s.chosen]} onPress={() => choose(yes)}>
            <Text style={[s.choiceText, asked === yes && s.chosenText]}>{yes ? 'Yes' : 'No'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {asked && (
        <>
          <TextInput
            style={s.input}
            placeholder="What did they say? (optional)"
            placeholderTextColor="#9CA3AF"
            value={value.off_app_note ?? ''}
            onChangeText={(off_app_note) => onChange({ ...value, off_app_note })}
            multiline
            maxLength={2000}
          />
          <Text style={s.hint}>Only our team sees this. Paying in the app keeps your refund and dispute protection.</Text>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { width: '100%', marginBottom: 14, gap: 8 },
  question: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  choices: { flexDirection: 'row', gap: 8 },
  choice: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 20, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff' },
  chosen: { borderColor: '#111827', backgroundColor: '#111827' },
  choiceText: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  chosenText: { color: '#fff' },
  input: {
    minHeight: 60, borderRadius: 12, backgroundColor: '#F3F4F6', padding: 12, textAlignVertical: 'top',
    fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppins, color: '#111827',
  },
  hint: { fontSize: 11.5, lineHeight: 16, fontFamily: Fonts.poppins, color: '#6B7280' },
});
