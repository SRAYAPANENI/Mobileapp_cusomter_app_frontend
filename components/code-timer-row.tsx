import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import type { CodeTimer } from '@/hooks/use-code-timer';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Under a texted-code box, the same on every screen that sends one (login,
 * register, forgot password): how long the code lasts, and Resend once it may
 * be sent again. */
export function CodeTimerRow({ timer, onResend }: { timer: CodeTimer; onResend: () => void }) {
  const theme = Colors[useColorScheme() ?? 'light'];
  const canResend = timer.resendIn === 0;
  return (
    // The page's own background behind the text: the animated background's
    // floating icons would otherwise show through it.
    <View style={[styles.row, { backgroundColor: theme.background }]}>
      <ThemedText style={[styles.text, timer.expired && styles.expired]}>
        {timer.expired ? 'Code expired — resend' : timer.expiresIn > 0 ? `Code expires in ${clock(timer.expiresIn)}` : ''}
      </ThemedText>
      <TouchableOpacity onPress={onResend} disabled={!canResend} hitSlop={8}>
        <ThemedText style={[styles.text, styles.bold, { color: canResend ? theme.brand : theme.icon }]}>
          {canResend ? 'Resend' : `Resend in ${timer.resendIn}s`}
        </ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  text: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: Fonts.poppins,
    opacity: 0.75,
  },
  bold: {
    fontFamily: Fonts.poppinsBold,
    opacity: 1,
  },
  expired: {
    color: '#DC2626',
    opacity: 1,
  },
});
