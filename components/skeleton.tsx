import { useColorScheme } from '@/hooks/use-color-scheme';
import React, { useEffect } from 'react';
import { DimensionValue, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

// Generic gray placeholder block with a slow pulse — the shape (width/
// height/borderRadius) is left to the caller so each screen can compose its
// own skeleton matching its real layout (see ProfileSkeleton, JobCardSkeleton
// usage in profile.tsx / my-jobs.tsx), the same way LinkedIn's skeleton rows
// are shaped like the real list items they stand in for.
interface Props {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const base = colorScheme === 'dark' ? '#374151' : '#E5E7EB';
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[{ width, height, borderRadius, backgroundColor: base }, animatedStyle, style]} />
  );
}
