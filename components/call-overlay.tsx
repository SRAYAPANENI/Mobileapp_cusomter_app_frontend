import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { Colors } from '@/constants/theme';
import { Image } from 'expo-image';
import { Mic, MicOff, Phone, PhoneOff, Volume2 } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, RadialGradient as SvgRadialGradient, Rect, Stop } from 'react-native-svg';

export type CallState = 'idle' | 'connecting' | 'calling' | 'ringing' | 'connected';

interface CallOverlayProps {
  callState: CallState;
  name: string;
  profileImage?: string | null;
  isMuted: boolean;
  isSpeakerOn: boolean;
  callDuration: number;
  themeColors: typeof Colors.light;
  onAccept: () => void;
  onDecline: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const BRAND = '#FFCE48';
const DARK = '#0B0B0F';

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Concentric rings expanding outward from the avatar — the classic "calling/ringing" radar ping. */
function PulsingRing({ delay }: { delay: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.ease) }), -1, false)
    );
  }, [delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 0.9 }],
  }));

  return <Animated.View style={[styles.ring, style]} />;
}

/** A single decorative icon drifting slowly up and down in the background. */
function FloatingIcon({
  Icon, top, left, size, duration, delay,
}: { Icon: typeof Phone; top: number; left: number; size: number; duration: number; delay: number }) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0.06);

  useEffect(() => {
    translateY.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(-16, { duration, easing: Easing.inOut(Easing.sin) }),
          withTiming(0, { duration, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        true
      )
    );
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(0.14, { duration: duration * 0.8 }),
          withTiming(0.06, { duration: duration * 0.8 })
        ),
        -1,
        true
      )
    );
  }, [delay, duration, opacity, translateY]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[{ position: 'absolute', top, left }, style]}>
      <Icon size={size} color={BRAND} />
    </Animated.View>
  );
}

export function CallOverlay({
  callState, name, profileImage, isMuted, isSpeakerOn, callDuration, themeColors: _themeColors,
  onAccept, onDecline, onEnd, onToggleMute, onToggleSpeaker,
}: CallOverlayProps) {
  if (callState === 'idle') return null;

  const isRingingOrCalling = callState === 'ringing' || callState === 'calling' || callState === 'connecting';

  const statusText =
    callState === 'connecting' ? 'Connecting…' :
    callState === 'ringing' ? 'Incoming call…' :
    callState === 'calling' ? 'Calling…' :
    formatDuration(callDuration);

  return (
    <View style={styles.overlay}>
      <Svg style={StyleSheet.absoluteFill} width={SCREEN_W} height={SCREEN_H}>
        <Defs>
          <SvgRadialGradient id="bg" cx="50%" cy="32%" r="75%">
            <Stop offset="0%" stopColor="#26210A" stopOpacity={1} />
            <Stop offset="55%" stopColor={DARK} stopOpacity={1} />
            <Stop offset="100%" stopColor="#000000" stopOpacity={1} />
          </SvgRadialGradient>
        </Defs>
        <Rect x={0} y={0} width={SCREEN_W} height={SCREEN_H} fill="url(#bg)" />
      </Svg>

      <FloatingIcon Icon={Phone} top={SCREEN_H * 0.12} left={SCREEN_W * 0.14} size={22} duration={2600} delay={0} />
      <FloatingIcon Icon={Volume2} top={SCREEN_H * 0.2} left={SCREEN_W * 0.78} size={26} duration={3200} delay={400} />
      <FloatingIcon Icon={Phone} top={SCREEN_H * 0.62} left={SCREEN_W * 0.82} size={18} duration={2800} delay={900} />
      <FloatingIcon Icon={Volume2} top={SCREEN_H * 0.7} left={SCREEN_W * 0.1} size={20} duration={3000} delay={300} />
      <FloatingIcon Icon={Phone} top={SCREEN_H * 0.42} left={SCREEN_W * 0.85} size={16} duration={2400} delay={1200} />

      <View style={styles.content}>
        <View style={styles.avatarWrap}>
          {isRingingOrCalling && (
            <>
              <PulsingRing delay={0} />
              <PulsingRing delay={700} />
              <PulsingRing delay={1400} />
            </>
          )}
          <Image
            source={profileImage ? { uri: profileImage } : require('@/assets/images/logo.png')}
            style={styles.avatar}
          />
        </View>
        <ThemedText style={styles.name}>{name}</ThemedText>
        <ThemedText style={styles.status}>{statusText}</ThemedText>
      </View>

      {callState === 'connecting' ? (
        <View style={styles.incomingRow}>
          <View style={styles.actionGroup}>
            <TouchableOpacity style={[styles.circleBtn, { backgroundColor: '#EF4444' }]} onPress={onDecline}>
              <PhoneOff size={28} color="#fff" />
            </TouchableOpacity>
            <ThemedText style={styles.actionLabel}>Cancel</ThemedText>
          </View>
        </View>
      ) : callState === 'ringing' ? (
        <View style={styles.incomingRow}>
          <View style={styles.actionGroup}>
            <TouchableOpacity style={[styles.circleBtn, { backgroundColor: '#EF4444' }]} onPress={onDecline}>
              <PhoneOff size={28} color="#fff" />
            </TouchableOpacity>
            <ThemedText style={styles.actionLabel}>Decline</ThemedText>
          </View>
          <View style={styles.actionGroup}>
            <TouchableOpacity style={[styles.circleBtn, { backgroundColor: '#10B981' }]} onPress={onAccept}>
              <Phone size={28} color="#fff" />
            </TouchableOpacity>
            <ThemedText style={styles.actionLabel}>Accept</ThemedText>
          </View>
        </View>
      ) : (
        <View style={styles.activeRow}>
          <View style={styles.actionGroup}>
            <TouchableOpacity
              style={[styles.smallCircleBtn, isMuted && { backgroundColor: BRAND }]}
              onPress={onToggleMute}
            >
              {isMuted ? <MicOff size={22} color="#000" /> : <Mic size={22} color="#fff" />}
            </TouchableOpacity>
            <ThemedText style={styles.actionLabelSmall}>Mute</ThemedText>
          </View>
          <View style={styles.actionGroup}>
            <TouchableOpacity
              style={[styles.smallCircleBtn, isSpeakerOn && { backgroundColor: BRAND }]}
              onPress={onToggleSpeaker}
            >
              <Volume2 size={22} color={isSpeakerOn ? '#000' : '#fff'} />
            </TouchableOpacity>
            <ThemedText style={styles.actionLabelSmall}>Speaker</ThemedText>
          </View>
          <View style={styles.actionGroup}>
            <TouchableOpacity style={[styles.circleBtn, { backgroundColor: '#EF4444' }]} onPress={onEnd}>
              <PhoneOff size={28} color="#fff" />
            </TouchableOpacity>
            <ThemedText style={styles.actionLabel}>End</ThemedText>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 100,
    backgroundColor: DARK,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 100,
    paddingBottom: 80,
    overflow: 'hidden',
  },
  content: {
    alignItems: 'center',
  },
  avatarWrap: {
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  ring: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: BRAND,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#1F2024',
  },
  name: {
    fontSize: 24,
    fontFamily: Fonts.poppinsBold,
    color: '#fff',
  },
  status: {
    fontSize: 16,
    fontFamily: Fonts.poppins,
    color: 'rgba(255,255,255,0.65)',
    marginTop: 8,
  },
  incomingRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '80%',
  },
  activeRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '90%',
  },
  actionGroup: {
    alignItems: 'center',
    gap: 8,
  },
  circleBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallCircleBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    fontSize: 13,
    fontFamily: Fonts.poppins,
    color: '#fff',
  },
  actionLabelSmall: {
    fontSize: 12,
    fontFamily: Fonts.poppins,
    color: 'rgba(255,255,255,0.65)',
  },
});
