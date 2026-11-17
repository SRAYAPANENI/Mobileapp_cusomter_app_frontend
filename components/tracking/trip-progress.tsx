import { ThemedText } from '@/components/themed-text';
import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Check } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';

// The job's steps as a line of dots: done ones ticked, the current one in the
// brand colour, the rest waiting — where things are, at a glance. Each step
// is a column (its dot over its label), so labels always sit under their dot.
export function TripProgress({ steps, current }: { steps: string[]; current: number }) {
  const t = Colors[useColorScheme() ?? 'light'];
  const n = steps.length;
  // The line runs between the first and last dot's centres: each column is 1/n wide.
  const inset = `${50 / n}%` as const;
  const reached = Math.max(0, Math.min(current, n - 1));
  const filled = n > 1 ? (reached / (n - 1)) * (100 - 100 / n) : 0;
  return (
    <View
      style={s.wrap}
      accessible
      accessibilityLabel={`Step ${Math.min(current + 1, n)} of ${n}: ${steps[reached]}`}
    >
      <View style={[s.line, { left: inset, right: inset, backgroundColor: t.border }]} />
      <View style={[s.line, { left: inset, width: `${filled}%`, backgroundColor: t.textPrimary }]} />
      <View style={s.row}>
        {steps.map((label, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <View key={label} style={s.col}>
              <View
                style={[
                  s.dot,
                  { borderColor: done || now ? t.textPrimary : t.border, backgroundColor: done ? t.textPrimary : now ? t.brand : t.card },
                ]}
              >
                {done && <Check size={10} color={t.card} strokeWidth={3.5} />}
              </View>
              <ThemedText
                numberOfLines={1}
                style={[s.label, { color: now ? t.textPrimary : t.textMuted }, now && s.labelNow]}
              >
                {label}
              </ThemedText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const DOT = 16;

const s = StyleSheet.create({
  wrap: { position: 'relative' },
  line: { position: 'absolute', top: DOT / 2 - 1, height: 2, borderRadius: 1 },
  row: { flexDirection: 'row' },
  col: { flex: 1, alignItems: 'center', gap: 6 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 11, lineHeight: 15, fontFamily: Fonts.poppins, textAlign: 'center', paddingHorizontal: 2 },
  labelNow: { fontFamily: Fonts.poppinsSemiBold },
});
