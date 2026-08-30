import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  Hammer,
  Home,
  Paintbrush,
  Sparkles,
  Wrench,
  Zap,
} from 'lucide-react-native';
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const ICONS = [
  { Icon: Hammer,      top: '12%', left: '8%',  delay: 0,    duration: 3200 },
  { Icon: Wrench,      top: '18%', right: '10%', delay: 600,  duration: 3800 },
  { Icon: Home,        top: '45%', left: '5%',  delay: 1200, duration: 3500 },
  { Icon: Sparkles,    top: '50%', right: '7%', delay: 400,  duration: 4000 },
  { Icon: Paintbrush,  top: '75%', left: '12%', delay: 900,  duration: 3300 },
  { Icon: Zap,         top: '72%', right: '12%',delay: 1600, duration: 3700 },
];

function FloatingIcon({
  Icon,
  style,
  delay,
  duration,
  color,
}: {
  Icon: any;
  style: any;
  delay: number;
  duration: number;
  color: string;
}) {
  const translateY = useSharedValue(0);

  useEffect(() => {
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-14, { duration }),
          withTiming(0, { duration })
        ),
        -1,
        false
      )
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.floatingIcon, style, animatedStyle]}>
      <Icon size={22} color={color} />
    </Animated.View>
  );
}

export default function AnimatedBackground() {
  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];

  const orb1Scale = useSharedValue(1);
  const orb2Scale = useSharedValue(1);

  useEffect(() => {
    orb1Scale.value = withRepeat(
      withSequence(
        withTiming(1.3, { duration: 3000 }),
        withTiming(1, { duration: 3000 })
      ),
      -1,
      false
    );
    orb2Scale.value = withDelay(
      1500,
      withRepeat(
        withSequence(
          withTiming(1.2, { duration: 3500 }),
          withTiming(1, { duration: 3500 })
        ),
        -1,
        false
      )
    );
  }, []);

  const orb1Style = useAnimatedStyle(() => ({
    transform: [{ scale: orb1Scale.value }],
  }));

  const orb2Style = useAnimatedStyle(() => ({
    transform: [{ scale: orb2Scale.value }],
  }));

  const iconColor = colorScheme === 'dark' ? 'rgba(255,206,72,0.18)' : 'rgba(0,0,0,0.08)';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: themeColors.background }]} />

      {/* Pulsing orbs */}
      <Animated.View
        style={[styles.orb, { top: -100, left: -100, backgroundColor: themeColors.brand, opacity: 0.08 }, orb1Style]}
      />
      <Animated.View
        style={[styles.orb, { bottom: -100, right: -100, backgroundColor: themeColors.brand, opacity: 0.06 }, orb2Style]}
      />

      {/* Floating service icons */}
      {ICONS.map(({ Icon, top, left, right, delay, duration }, i) => (
        <FloatingIcon
          key={i}
          Icon={Icon}
          style={{ top, left, right }}
          delay={delay}
          duration={duration}
          color={iconColor}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  orb: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  floatingIcon: {
    position: 'absolute',
    opacity: 0.9,
  },
});
