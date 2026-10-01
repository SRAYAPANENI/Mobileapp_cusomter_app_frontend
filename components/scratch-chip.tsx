import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

interface ScratchChipProps {
  revealed: boolean;
  style?: any;
  color: string;
}

/**
 * One cell of a ScratchCard's cover grid. Owns its own fade/scale — the
 * parent only ever flips `revealed`, never reaches in to animate a chip
 * directly, so chips stay swappable/reusable outside ScratchCard too.
 */
export default function ScratchChip({ revealed, style, color }: ScratchChipProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!revealed) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [revealed, progress]);

  return (
    <View style={[styles.cell, style]} pointerEvents="none">
      <Animated.View
        style={[
          styles.chip,
          { backgroundColor: color },
          {
            opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { position: 'absolute' },
  chip: { width: '100%', height: '100%', borderRadius: 3 },
});
