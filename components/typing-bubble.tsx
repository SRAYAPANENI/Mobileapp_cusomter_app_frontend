import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing, FadeInLeft, cancelAnimation, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const CYCLE_MS = 1200;
const DOTS = [0, 1, 2];
// Each dot rises a little after the one before it.
const STAGGER = 0.15;

function Dot({ index, clock, color }: { index: number; clock: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const t = (clock.value - index * STAGGER + 1) % 1;
    const rise = interpolate(t, [0, 0.2, 0.4, 1], [0, 1, 0, 0]);
    return { opacity: 0.4 + rise * 0.6, transform: [{ translateY: -4 * rise }] };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/** The other side is typing: an incoming bubble with three dots rising in turn. */
export function TypingBubble({ name }: { name: string }) {
  const t = Colors[useColorScheme() ?? 'light'];
  const clock = useSharedValue(0);

  useEffect(() => {
    clock.value = withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1);
    return () => cancelAnimation(clock);
  }, [clock]);

  return (
    <Animated.View entering={FadeInLeft.duration(180)} style={styles.row}>
      <View
        style={[styles.bubble, { backgroundColor: t.card, borderColor: t.borderSubtle }]}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${name} is typing`}
      >
        {DOTS.map((i) => <Dot key={i} index={i} clock={clock} color={t.textMuted} />)}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { alignSelf: 'flex-start', marginBottom: 16 },
  bubble: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 42, paddingHorizontal: 16,
    borderRadius: 20, borderBottomLeftRadius: 4, borderWidth: 1,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
});
