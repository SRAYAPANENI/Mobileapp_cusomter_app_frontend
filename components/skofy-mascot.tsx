import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

interface SkoFyMascotProps {
  size?: number;
}

// A small, self-contained mascot built entirely from Views (no external
// image/Lottie assets exist in this project yet) — floats, sways, blinks,
// and has a pulsing "AI" antenna light so the voice-first hero card reads
// as alive rather than a plain text block.
export function SkoFyMascot({ size = 56 }: SkoFyMascotProps) {
  const bob = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const bobLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    const swayLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(sway, { toValue: -1, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(sway, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.6, duration: 900, useNativeDriver: true }),
      ])
    );
    // Blink every ~3.4s: quick close, quick open, long pause.
    const blinkLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(3000),
        Animated.timing(blink, { toValue: 0.08, duration: 90, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 120, useNativeDriver: true }),
      ])
    );
    bobLoop.start();
    swayLoop.start();
    glowLoop.start();
    blinkLoop.start();
    return () => { bobLoop.stop(); swayLoop.stop(); glowLoop.stop(); blinkLoop.stop(); };
  }, [bob, sway, blink, glow]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
  const rotate = sway.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] });
  const scale = size / 56;

  return (
    <Animated.View
      style={[
        styles.wrap,
        { width: size, height: size + 12, transform: [{ translateY }, { rotate }] },
      ]}
    >
      {/* Antenna */}
      <View style={[styles.antennaStem, { transform: [{ scale }] }]} />
      <Animated.View style={[styles.antennaTip, { opacity: glow, transform: [{ scale }] }]} />

      {/* Body */}
      <View style={[styles.body, { width: size, height: size, borderRadius: size * 0.4, transform: [{ scale: 1 }] }]}>
        <View style={styles.faceplate}>
          <Animated.View style={[styles.eye, { transform: [{ scaleY: blink }] }]} />
          <Animated.View style={[styles.eye, { transform: [{ scaleY: blink }] }]} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'flex-end' },
  antennaStem: {
    position: 'absolute',
    top: 0,
    width: 3,
    height: 10,
    borderRadius: 1.5,
    backgroundColor: '#111827',
  },
  antennaTip: {
    position: 'absolute',
    top: -3,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#7C3AED',
    shadowColor: '#7C3AED',
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  body: {
    backgroundColor: '#FFCE48',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceplate: {
    width: '58%',
    height: '40%',
    borderRadius: 12,
    backgroundColor: '#111827',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  eye: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
});
