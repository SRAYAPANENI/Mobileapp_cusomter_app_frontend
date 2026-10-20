import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Image } from 'expo-image';
import React, { type ReactNode, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
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

// The Dodorez mark with brand-coloured rings pulsing out of it — the same
// mark wherever the logo shows (dashboard, login, page headers, support
// chat), so it reads as one living brand rather than a static image in some
// places. `children` replaces the plain mark (e.g. the support chat's round
// avatar badge) and gets the rings around it instead.
export default function AnimatedLogoMark({
  size,
  children,
}: {
  size: number;
  children?: ReactNode;
}) {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];

  const ringSize = size * 1.3;
  const ringOffset = -(ringSize - size) / 2;

  return (
    <View style={[styles.markWrap, { width: size, height: size }]}>
      <View style={[styles.ringWrap, { width: ringSize, height: ringSize, top: ringOffset, left: ringOffset }]} pointerEvents="none">
        <PingRing size={ringSize} color={themeColors.brand} delay={0} />
        <PingRing size={ringSize} color={themeColors.brand} delay={1100} />
      </View>
      <Animated.View entering={FadeInDown.duration(600)}>
        {children ?? (
          <Image
            source={require('@/assets/images/logo-mark.png')}
            style={{ width: size, height: size }}
            contentFit="contain"
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  markWrap: { alignItems: 'center', justifyContent: 'center' },
  ringWrap: { position: 'absolute' },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
});
