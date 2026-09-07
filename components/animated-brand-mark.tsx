import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
import { MapPin } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

function PingRing({
  size,
  color,
  delay,
}: {
  size: number;
  color: string;
  delay: number;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    scale.value = withDelay(
      delay,
      withRepeat(withTiming(1.9, { duration: 2200 }), -1, false)
    );
    opacity.value = withDelay(
      delay,
      withRepeat(withTiming(0, { duration: 2200 }), -1, false)
    );
  }, []);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.ring,
        {
          // No top/left set — this ring is meant to exactly fill its
          // ringWrap parent (same size), and position:'absolute' with no
          // insets defaults to (0,0), which is exactly that.
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: color,
        },
        ringStyle,
      ]}
    />
  );
}

// Icon + wordmark + an invisible spacer (same width as the icon) sit in one
// normal flex row. Because the spacer balances the icon's width on the
// other side, the row is symmetric around the wordmark — so centering the
// whole row (via the outer container's alignItems:'center') puts the
// wordmark itself at true-center, matching text below it like "Welcome
// Back". Same technique as an "icon + centered title" nav header. A
// previous version tried to achieve this with position:'absolute' on the
// icon instead — that made the icon disappear entirely, so this normal-flow
// approach replaces it rather than debugging the absolute-positioning edge
// case further.
export default function AnimatedBrandMark({
  size = 48,
  showName = true,
  nameSize = 34,
  centered = true,
  offsetX = 0,
}: {
  size?: number;
  showName?: boolean;
  nameSize?: number;
  // The ghost spacer only matters when this sits above other fully-centered
  // text (e.g. login's "Welcome Back") that needs to share the same true
  // center. In a compact header row (icon anchored left, other controls to
  // the right), the extra invisible width just pushes everything else
  // further right for no reason — skip it there.
  centered?: boolean;
  // Optical nudge away from true-center, for when mathematically-centered
  // doesn't look centered (the icon's visual weight on one side can throw
  // that off). Doesn't affect sibling text below it, since it's applied to
  // just this row, not the shared centering axis.
  offsetX?: number;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];

  const ringSize = size * 1.3;
  const ringOffset = -(ringSize - size) / 2;
  const gap = 10;
  const sideWidth = size + gap;

  return (
    <View style={styles.container}>
      <View style={[styles.brandRow, { marginLeft: offsetX }]}>
        <View style={{ width: sideWidth, height: size }}>
          <View style={[styles.markWrap, { width: size, height: size }]}>
            <View style={[styles.ringWrap, { width: ringSize, height: ringSize, top: ringOffset, left: ringOffset }]}>
              <PingRing size={ringSize} color={themeColors.brand} delay={0} />
              <PingRing size={ringSize} color={themeColors.brand} delay={1100} />
            </View>
            <Animated.View entering={FadeInDown.duration(600).springify()}>
              <Image
                source={require('@/assets/images/logo-mark.png')}
                style={{ width: size, height: size }}
                contentFit="contain"
              />
            </Animated.View>
          </View>
        </View>
        {showName && (
          <Animated.View
            entering={FadeInDown.delay(250).duration(500)}
            style={styles.nameRow}
          >
            <Text style={[styles.name, { fontSize: nameSize, color: themeColors.textPrimary }]}>
              Dod
            </Text>
            {/* Stands in for the second "o" in "Dodorez". Stroke-only (no
                fill) so the pin's natural teardrop-with-a-circle-cutout shape
                stays visible — filling it solid paints over that circle,
                which is the part that actually reads as an "o". */}
            <MapPin
              size={nameSize * 0.8}
              color={themeColors.brand}
              strokeWidth={2.5}
              style={styles.pinLetter}
            />
            <Text style={[styles.name, { fontSize: nameSize, color: themeColors.brand }]}>
              rez
            </Text>
          </Animated.View>
        )}
        {/* Ghost spacer — invisible, same width as the icon slot, balances
            the row so the wordmark lands at true-center. */}
        {centered && <View style={{ width: sideWidth }} pointerEvents="none" />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  markWrap: { alignItems: 'center', justifyContent: 'center' },
  ringWrap: { position: 'absolute' },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: { fontFamily: Fonts.poppinsBold, letterSpacing: 0.2 },
  pinLetter: { marginHorizontal: -1 },
});
