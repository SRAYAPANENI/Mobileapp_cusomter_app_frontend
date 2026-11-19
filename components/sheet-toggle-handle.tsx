import { ChevronUp } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

// The handle of a bottom card that folds down to show more of the map. A
// bare grey line didn't say it could be tapped: this is an arrow pointing
// where the card will go — down while it's open, up while it's folded — that
// turns as it moves, and bobs a little (three times) when the screen opens
// and after each tap, then rests. Not forever: people watch a tracking screen
// for twenty minutes. Still, with the phone's "reduce motion" on.

const BOB_PX = 3;
const BOB_MS = 260;
const BOBS = 3;

export function SheetToggleHandle({ expanded, onPress, expandLabel, collapseLabel }: {
  /** The card is open (the arrow points down: tap to fold it). */
  expanded: boolean;
  onPress: () => void;
  /** Read out while folded, and while open. */
  expandLabel: string;
  collapseLabel: string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const t = Colors[scheme];
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(expanded ? 180 : 0);
  const bob = useSharedValue(0);

  // Points where the card will go: turns with it.
  useEffect(() => {
    turn.value = reduceMotion ? (expanded ? 180 : 0) : withTiming(expanded ? 180 : 0, { duration: 220 });
  }, [expanded, reduceMotion, turn]);

  // A few gentle bobs toward where it'll go, then still.
  useEffect(() => {
    if (reduceMotion) return;
    const toward = expanded ? BOB_PX : -BOB_PX;
    bob.value = 0;
    bob.value = withRepeat(
      withSequence(withTiming(toward, { duration: BOB_MS }), withTiming(0, { duration: BOB_MS })),
      BOBS,
      false,
    );
    return () => cancelAnimation(bob);
  }, [expanded, reduceMotion, bob]);

  const arrowStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bob.value }, { rotate: `${turn.value}deg` }],
  }));

  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={12}
      style={[s.pill, { backgroundColor: t.inputFilled }]}
      accessibilityRole="button"
      accessibilityLabel={expanded ? collapseLabel : expandLabel}
      accessibilityState={{ expanded }}
    >
      <Animated.View style={arrowStyle}>
        <ChevronUp size={20} color={t.textSecondary} strokeWidth={2.5} />
      </Animated.View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  pill: { width: 52, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
