import { Fonts } from '@/constants/theme';
import React, { useEffect, useRef, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { ThemedText } from './themed-text';

// ── Floating Z ───────────────────────────────────────────────────────────────
function ZFloat({ left, top, size, delay, driftX = 6 }: {
  left: number; top: number; size: number; delay: number; driftX?: number;
}) {
  const opacity = useSharedValue(0);
  const transY   = useSharedValue(0);
  const transX   = useSharedValue(0);

  useEffect(() => {
    const cycle = 2600;
    opacity.value = withRepeat(
      withDelay(delay, withSequence(
        withTiming(0,   { duration: 0 }),
        withTiming(1,   { duration: 350,          easing: Easing.out(Easing.quad) }),
        withTiming(0.9, { duration: cycle - 900 }),
        withTiming(0,   { duration: 550,          easing: Easing.in(Easing.quad) }),
      )),
      -1,
    );
    transY.value = withRepeat(
      withDelay(delay, withSequence(
        withTiming(0,   { duration: 0 }),
        withTiming(-54, { duration: cycle, easing: Easing.out(Easing.cubic) }),
      )),
      -1,
    );
    transX.value = withRepeat(
      withDelay(delay, withSequence(
        withTiming(0,       { duration: 0 }),
        withTiming(driftX,  { duration: cycle, easing: Easing.inOut(Easing.sin) }),
      )),
      -1,
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left,
    top,
    opacity: opacity.value,
    transform: [{ translateY: transY.value }, { translateX: transX.value }],
  }));

  return (
    <Animated.Text style={[{
      fontSize: size,
      fontFamily: Fonts.poppinsBold,
      color: '#F59E0B',
      includeFontPadding: false,
    }, style]}>
      z
    </Animated.Text>
  );
}

// ── SVG character ─────────────────────────────────────────────────────────────
function WorkerFace({ blink }: { blink: boolean }) {
  return (
    <Svg width={150} height={150} viewBox="0 0 150 150">
      {/* Body */}
      <Path
        d="M32,118 Q26,150 75,150 Q124,150 118,118 Q112,105 75,102 Q38,105 32,118 Z"
        fill="#EEF2FF"
      />
      {/* Collar */}
      <Path d="M60,103 L75,120 L90,103" stroke="#C7D2FE" strokeWidth="2.5"
        fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* Head */}
      <Circle cx="75" cy="70" r="52" fill="#FFCE48" />

      {/* Hard-hat brim */}
      <Path d="M20,62 Q75,40 130,62 L126,70 Q75,48 24,70 Z" fill="#1F2937" />
      {/* Hat dome */}
      <Ellipse cx="75" cy="48" rx="32" ry="20" fill="#1F2937" />
      {/* Hat stripe */}
      <Path d="M47,56 Q75,47 103,56" stroke="#FFCE48" strokeWidth="3.5"
        fill="none" strokeLinecap="round" />

      {/* LEFT EYE */}
      <Ellipse cx="54" cy="72" rx="11.5" ry="13" fill="white" />
      {!blink && <>
        <Circle cx="54" cy="76" r="6" fill="#1F2937" />
        <Circle cx="56.5" cy="73.5" r="2.2" fill="white" opacity={0.75} />
      </>}
      <Path
        d={blink
          ? 'M42.5,67 Q54,59 65.5,67 L65.5,85 Q54,88 42.5,85 Z'
          : 'M42.5,67 Q54,59 65.5,67 L65.5,72 Q54,65 42.5,72 Z'}
        fill="#FFCE48"
      />

      {/* RIGHT EYE */}
      <Ellipse cx="96" cy="72" rx="11.5" ry="13" fill="white" />
      {!blink && <>
        <Circle cx="96" cy="76" r="6" fill="#1F2937" />
        <Circle cx="98.5" cy="73.5" r="2.2" fill="white" opacity={0.75} />
      </>}
      <Path
        d={blink
          ? 'M84.5,67 Q96,59 107.5,67 L107.5,85 Q96,88 84.5,85 Z'
          : 'M84.5,67 Q96,59 107.5,67 L107.5,72 Q96,65 84.5,72 Z'}
        fill="#FFCE48"
      />

      {/* Mouth — slight frown */}
      <Path d="M60,92 Q75,88 90,92" stroke="#C47A35" strokeWidth="3"
        fill="none" strokeLinecap="round" />

      {/* Blush */}
      <Circle cx="37" cy="82" r="10" fill="#FB923C" opacity={0.16} />
      <Circle cx="113" cy="82" r="10" fill="#FB923C" opacity={0.16} />
    </Svg>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
interface EmptyJobsStateProps {
  title?: string;
  subtitle?: string;
  onPress?: () => void;
  buttonLabel?: string;
}

export function EmptyJobsState({
  title = 'No jobs yet',
  subtitle = 'Post your first job to get started!',
  onPress,
  buttonLabel = 'Post a Job',
}: EmptyJobsStateProps) {
  const [blink, setBlink] = useState(false);
  const blinkRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bobY        = useSharedValue(0);
  const shadowScale = useSharedValue(1);

  useEffect(() => {
    bobY.value = withRepeat(
      withTiming(-13, { duration: 2100, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    shadowScale.value = withRepeat(
      withTiming(0.65, { duration: 2100, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );

    const scheduleBlink = () => {
      const wait = 2500 + Math.random() * 2200;
      blinkRef.current = setTimeout(() => {
        setBlink(true);
        blinkRef.current = setTimeout(() => {
          setBlink(false);
          scheduleBlink();
        }, 175);
      }, wait);
    };
    scheduleBlink();

    return () => { if (blinkRef.current) clearTimeout(blinkRef.current); };
  }, []);

  const bobStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bobY.value }],
  }));
  const shadowStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: shadowScale.value }],
    opacity: 0.55 + shadowScale.value * 0.2,
  }));

  return (
    <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 24 }}>
      <Animated.View style={[{ alignItems: 'center' }, bobStyle]}>
        <View style={{ width: 190, height: 160, alignItems: 'center' }}>
          {/* Zzz anchored to upper-right of head, move with the bob */}
          <ZFloat left={112} top={32}  size={15} delay={0}    driftX={6}  />
          <ZFloat left={126} top={16}  size={20} delay={850}  driftX={10} />
          <ZFloat left={140} top={0}   size={25} delay={1700} driftX={14} />

          <View style={{ position: 'absolute', left: 0, top: 5 }}>
            <WorkerFace blink={blink} />
          </View>
        </View>
      </Animated.View>

      {/* Ground shadow */}
      <Animated.View style={[{
        width: 72,
        height: 10,
        borderRadius: 5,
        backgroundColor: '#00000018',
        marginTop: 2,
      }, shadowStyle]} />

      <ThemedText style={{
        fontSize: 19,
        fontFamily: Fonts.poppinsBold,
        color: '#1F2937',
        marginTop: 18,
        textAlign: 'center',
      }}>
        {title}
      </ThemedText>

      <ThemedText style={{
        fontSize: 14,
        fontFamily: Fonts.poppins,
        color: '#9CA3AF',
        marginTop: 7,
        textAlign: 'center',
        lineHeight: 21,
      }}>
        {subtitle}
      </ThemedText>

      {onPress && (
        <TouchableOpacity
          onPress={onPress}
          activeOpacity={0.82}
          style={{
            marginTop: 26,
            backgroundColor: '#FFCE48',
            borderRadius: 20,
            paddingHorizontal: 36,
            paddingVertical: 14,
          }}
        >
          <ThemedText style={{
            fontFamily: Fonts.poppinsBold,
            color: '#111827',
            fontSize: 14,
          }}>
            {buttonLabel}
          </ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}
